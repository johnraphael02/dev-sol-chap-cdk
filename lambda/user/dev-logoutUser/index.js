const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

// Environment variables
const TABLE_NAME = process.env.USERS_TABLE_NAME || "Dev-Users";
const QUEUE_URL = process.env.AUTH_QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";
const ENCRYPTION_LAMBDA = process.env.ENCRYPTION_LAMBDA || "sol-chap-encryption";

// 🔐 Helper: Encrypt a single value via Lambda
const encryptField = async (value) => {
  try {
    const response = await lambda.invoke({
      FunctionName: ENCRYPTION_LAMBDA,
      InvocationType: "RequestResponse",
      Payload: JSON.stringify({ body: JSON.stringify({ text: value }) }),
    }).promise();

    const parsed = JSON.parse(response.Payload);
    const encrypted = JSON.parse(parsed.body).encryptedData;

    if (!encrypted) throw new Error("Missing encryptedData from encryption lambda");
    return encrypted;
  } catch (error) {
    console.error("🔐 Encryption error:", error.message);
    throw error;
  }
};

exports.handler = async (event) => {
  console.log("📥 Received event:", JSON.stringify(event, null, 2));

  try {
    const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    const { userId, email } = body || {};

    if (!userId || !email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required fields: userId, email" }),
      };
    }

    const timestamp = new Date().toISOString();

    // 🔐 Encrypt PK, SK and LOGOUT event value
    const [encryptedPK, encryptedSK, encryptedEvent] = await Promise.all([
      encryptField(`USER#${userId}`),
      encryptField("SESSION"),
      encryptField("LOGOUT"),
    ]);

    // ✅ Step 1: Update SESSION record in DynamoDB using encrypted PK/SK
    try {
      await dynamoDB.update({
        TableName: TABLE_NAME,
        Key: {
          PK: encryptedPK,
          SK: encryptedSK,
        },
        UpdateExpression: "SET #event = :event, updatedAt = :timestamp",
        ExpressionAttributeNames: {
          "#event": "event",
        },
        ExpressionAttributeValues: {
          ":event": encryptedEvent,
          ":timestamp": timestamp,
        },
      }).promise();

      console.log("✅ DynamoDB session logout update complete.");
    } catch (dbErr) {
      console.error("❌ DynamoDB Update Failed:", dbErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "DynamoDB update failed", details: dbErr.message }),
      };
    }

    // ✅ Step 2: Send logout event to SQS (plain message)
    if (QUEUE_URL) {
      try {
        await sqs.sendMessage({
          QueueUrl: QUEUE_URL,
          MessageBody: JSON.stringify({ userId, action: "logout", timestamp }),
        }).promise();
        console.log("📤 Logout event sent to SQS.");
      } catch (sqsErr) {
        console.error("❌ SQS Error:", sqsErr.message);
      }
    }

    // ✅ Step 3: Trigger EventBridge Event (plain message)
    try {
      await eventBridge.putEvents({
        Entries: [
          {
            Source: "auth.service",
            DetailType: "LogoutEvent",
            Detail: JSON.stringify({ userId, email, timestamp }),
            EventBusName: EVENT_BUS_NAME,
          },
        ],
      }).promise();
      console.log("📡 EventBridge logout event sent.");
    } catch (eventBridgeErr) {
      console.error("❌ EventBridge Error:", eventBridgeErr.message);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "User successfully logged out.",
        userId,
      }),
    };
  } catch (err) {
    console.error("❌ Logout Handler Error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal Server Error",
        debug_message: err.message,
        debug_stack: err.stack,
      }),
    };
  }
};
