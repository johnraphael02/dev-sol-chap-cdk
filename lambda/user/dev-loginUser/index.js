const AWS = require("aws-sdk");
const bcrypt = require("bcryptjs");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();

const USERS_TABLE = "Dev-Users";
const EMAIL_INDEX = "Dev-EmailIndex";
const ENCRYPTION_LAMBDA = "sol-chap-encryption";

// 🔐 Encrypt Data Using Lambda
async function encryptData(data) {
  const params = {
    FunctionName: ENCRYPTION_LAMBDA,
    Payload: JSON.stringify(data),
  };

  const response = await lambda.invoke(params).promise();
  const encryptedResponse = JSON.parse(response.Payload);

  if (encryptedResponse.statusCode !== 200) {
    throw new Error(`Encryption failed: ${encryptedResponse.body}`);
  }

  return JSON.parse(encryptedResponse.body).encryptedData;
}

exports.handler = async (event) => {
  try {
    console.log("📌 Received login request:", event.body);
    const { email, password } = JSON.parse(event.body);

    if (!email || !password) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Email and password are required" }),
      };
    }

    // ✅ Encrypt Email Before Querying
    const encryptedEmail = await encryptData({ email });
    console.log("🔑 Encrypted Email for Query:", encryptedEmail);

    // ✅ Query DynamoDB for User Using Encrypted Email
    const userQuery = await dynamoDB.query({
      TableName: USERS_TABLE,
      IndexName: EMAIL_INDEX,
      KeyConditionExpression: "GSI1PK = :emailKey",
      ExpressionAttributeValues: {
        ":emailKey": `EMAIL#${encryptedEmail}`,
      },
    }).promise();

    if (userQuery.Items.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "User not found." }),
      };
    }

    const user = userQuery.Items[0];

    // ✅ Verify Password
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: "Invalid credentials." }),
      };
    }

    // ✅ Generate Session ID
    const sessionId = require("uuid").v4();
    const timestamp = new Date().toISOString();

    // ✅ Update User with Session Info
    await dynamoDB.update({
      TableName: USERS_TABLE,
      Key: { PK: user.PK, SK: user.SK },
      UpdateExpression: "SET session_id = :session, session_created_at = :timestamp",
      ExpressionAttributeValues: {
        ":session": sessionId,
        ":timestamp": timestamp,
      },
    }).promise();

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "User authenticated successfully.", session: sessionId }),
    };
  } catch (error) {
    console.error("❌ Error during authentication:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error." }),
    };
  }
};
