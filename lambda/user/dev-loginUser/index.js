const AWS = require("aws-sdk");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

const docClient = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();

// ENV variables
const USERS_TABLE = process.env.USERS_TABLE || "Dev-Users";
const EMAIL_INDEX = process.env.EMAIL_INDEX || "Dev-EmailIndex";
const ENCRYPTION_LAMBDA = process.env.ENCRYPTION_LAMBDA || "sol-chap-encryption";

// 🔐 Helper: Encrypt a value via Encryption Lambda
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
  try {
    const { email, password } = JSON.parse(event.body || "{}");

    if (!email || !password) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Email and password are required." }),
      };
    }

    // 🔐 Step 1: Encrypt Email
    const encryptedEmail = await encryptField(email);
    const encryptedGSI1PK = `EMAIL#${encryptedEmail}`;

    // 🔍 Step 2: Query user using encrypted email via GSI
    const queryParams = {
      TableName: USERS_TABLE,
      IndexName: EMAIL_INDEX,
      KeyConditionExpression: "GSI1PK = :emailKey",
      ExpressionAttributeValues: {
        ":emailKey": encryptedGSI1PK,
      },
    };

    const userQuery = await docClient.query(queryParams).promise();

    if (!userQuery.Items || userQuery.Items.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: "User not found." }),
      };
    }

    const user = userQuery.Items[0];

    // 🔐 Step 3: Compare Password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: "Invalid credentials." }),
      };
    }

    // 🔐 Step 4: Encrypt event = LOGIN
    const encryptedEvent = await encryptField("LOGIN");

    // 🔐 Step 5: Create session info
    const sessionId = uuidv4();
    const timestamp = new Date().toISOString();

    // 🔍 Step 6: Query all SKs for the user using encrypted PK
    const getAllSKParams = {
      TableName: USERS_TABLE,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": user.PK, // Already encrypted from record
      },
    };

    const allSKItems = await docClient.query(getAllSKParams).promise();

    // 🔐 Step 7: Update all items with session + encrypted LOGIN event
    const updatePromises = allSKItems.Items.map((item) => {
      const updateParams = {
        TableName: USERS_TABLE,
        Key: {
          PK: item.PK,
          SK: item.SK,
        },
        UpdateExpression: "SET #event = :event, session_id = :sessionId, session_created_at = :timestamp",
        ExpressionAttributeNames: {
          "#event": "event",
        },
        ExpressionAttributeValues: {
          ":event": encryptedEvent,
          ":sessionId": sessionId,
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
    console.error("❌ Login Error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Internal server error.",
        debug_message: err.message,
        debug_stack: err.stack,
      }),
    };
  }
};
