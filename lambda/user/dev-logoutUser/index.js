const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

// Environment variables
const TABLE_NAME = process.env.USERS_TABLE_NAME || "Dev-Users";
const QUEUE_URL = process.env.AUTH_QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";
const ENCRYPTION_LAMBDA = "sol-chap-encryption";

// 🔐 Helper to encrypt a field value
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

    // 🔐 Encrypt only PK, SK and event field values
    const [encryptedPK, encryptedSK, encryptedEvent] = await Promise.all([
      encryptField(`USER#${userId}`),
      encryptField("SESSION"),
      encryptField("LOGOUT"),
    ]);

    // ✅ Step 1: Update encrypted session record in DynamoDB
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
          ":timestamp": new Date().toISOString(),
        },
      }).promise();

      console.log("✅ DynamoDB session updated with encrypted PK, SK, and event.");
    } catch (dbError) {
      console.error("❌ DynamoDB Update Error:", dbError.message);
      return {
        statusCode: 500,
        body: JSON.stringify({ message: "DynamoDB update failed", error: dbError.message }),
      };
    }

    // ✅ Step 2: Send plain user info to SQS
    if (QUEUE_URL) {
      try {
        await sqs.sendMessage({
          QueueUrl: QUEUE_URL,
          MessageBody: JSON.stringify({ userId, action: "logout" }),
        }).promise();
        console.log("📤 SQS Message sent.");
      } catch (sqsError) {
        console.error("❌ SQS Error:", sqsError.message);
      }
    }

    // ✅ Step 3: Trigger EventBridge event with plain data
    try {
      await eventBridge.putEvents({
        Entries: [
          {
            Source: "auth.service",
            DetailType: "LogoutEvent",
            Detail: JSON.stringify({ userId, email }),
            EventBusName: EVENT_BUS_NAME,
          },
        ],
      }).promise();

      console.log("📡 EventBridge event sent.");
    } catch (eventError) {
      console.error("❌ EventBridge Error:", eventError.message);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "User successfully logged out.",
        userId,
      }),
    };
  } catch (error) {
    console.error("❌ Handler Error:", error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error" }),
    };
  }
};
