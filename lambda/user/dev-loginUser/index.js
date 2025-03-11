const AWS = require("aws-sdk");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

const docClient = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();

// ENV variables
const USERS_TABLE = process.env.USERS_TABLE || "Dev-Users";
const EMAIL_INDEX = process.env.EMAIL_INDEX || "Dev-EmailIndex";
const ENCRYPTION_LAMBDA = process.env.ENCRYPTION_LAMBDA || "sol-chap-encryption";

// 🔐 Encrypt a field via Encryption Lambda
const encryptField = async (value) => {
  try {
    const response = await lambda.invoke({
      FunctionName: ENCRYPTION_LAMBDA,
      InvocationType: "RequestResponse",
      Payload: JSON.stringify({ body: JSON.stringify({ text: value }) }),
    }).promise();

    const parsed = JSON.parse(response.Payload);
    const encrypted = JSON.parse(parsed.body).encryptedData;

    if (!encrypted) throw new Error("Missing encryptedData");
    return encrypted;
  } catch (err) {
    console.error("🔐 Encryption error:", err.message);
    throw err;
  }
};

exports.handler = async (event) => {
  const { email, password } = JSON.parse(event.body || "{}");

  if (!email || !password) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Email and password are required." }),
    };
  }

  // Step 1: Query User by Email
  const params = {
    TableName: USERS_TABLE,
    IndexName: EMAIL_INDEX,
    KeyConditionExpression: "GSI1PK = :email AND begins_with(GSI1SK, :userPrefix)",
    ExpressionAttributeValues: {
      ":email": `EMAIL#${email}`,
      ":userPrefix": "USER#",
    },
  };

  try {
    const data = await docClient.query(params).promise();

    if (!data.Items || data.Items.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: "User not found." }),
      };
    }

    const user = data.Items[0];

    // Step 2: Validate password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: "Invalid credentials." }),
      };
    }

    // Step 3: Generate session info
    const sessionId = uuidv4();
    const timestamp = new Date().toISOString();

    // Step 4: Query all SKs for this user (based on unencrypted PK)
    const getAllSKParams = {
      TableName: USERS_TABLE,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": user.PK, // NOTE: still plain PK from user record
      },
    };

    const allSKItems = await docClient.query(getAllSKParams).promise();

    if (!allSKItems.Items || allSKItems.Items.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: "No user session data found." }),
      };
    }

    // Step 5: Encrypt only the values to be stored (NOT keys)
    const encryptedEvent = await encryptField("LOGIN");

    // Step 6: Update event/session fields for each SK
    const updatePromises = allSKItems.Items.map(async (item) => {
      const encryptedPK = await encryptField(item.PK);
      const encryptedSK = await encryptField(item.SK);

      const updateParams = {
        TableName: USERS_TABLE,
        Key: {
          PK: encryptedPK,
          SK: encryptedSK,
        },
        UpdateExpression: "SET #event = :event, session_id = :session, session_created_at = :timestamp",
        ExpressionAttributeNames: {
          "#event": "event",
        },
        ExpressionAttributeValues: {
          ":event": encryptedEvent,
          ":session": sessionId,
          ":timestamp": timestamp,
        },
      };

      return docClient.update(updateParams).promise();
    });

    await Promise.all(updatePromises);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "User authenticated successfully.",
        user_id: user.PK,
        session: sessionId,
      }),
    };
  } catch (err) {
    console.error("❌ Error during login:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal server error." }),
    };
  }
};
