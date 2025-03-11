const AWS = require("aws-sdk");
const bcrypt = require("bcryptjs");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const lambda = new AWS.Lambda();

const USERS_TABLE = "Dev-Users";
const USER_QUEUE_URL = process.env.USER_QUEUE_URL;
const EMAIL_INDEX = "Dev-EmailIndex";
const ENCRYPTION_LAMBDA = "sol-chap-encryption";

// 🔐 Helper: Invoke Encryption Lambda with a full object
async function encryptData(data) {
  const params = {
    FunctionName: ENCRYPTION_LAMBDA,
    Payload: JSON.stringify(data), // No wrapper body, send object directly
  };

  const response = await lambda.invoke(params).promise();
  console.log("Encryption Lambda Raw Response:", response);

  try {
    const encryptedResponse = JSON.parse(response.Payload);
    console.log("Parsed Encryption Response:", encryptedResponse);

    if (encryptedResponse.statusCode !== 200) {
      throw new Error(`Encryption failed: ${encryptedResponse.body}`);
    }

    const encryptedData = JSON.parse(encryptedResponse.body).encryptedData;
    console.log("Final Encrypted Data:", encryptedData);
    return encryptedData;
  } catch (err) {
    console.error("Error parsing encryption response:", err);
    throw new Error("Encryption Lambda response is invalid");
  }
}

exports.handler = async (event) => {
  try {
    console.log("📌 Received register request:", event.body);

    const requestBody = JSON.parse(event.body);
    const { id, email, password, username, membershipTier } = requestBody;

    // ✅ Validate input
    if (!id || !email || !password || !username || !membershipTier) {
      console.warn("⚠️ Missing required fields:", requestBody);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required fields" }),
      };
    }

    // ✅ Check for existing user via EmailIndex
    const existingUser = await dynamoDB.query({
      TableName: USERS_TABLE,
      IndexName: EMAIL_INDEX,
      KeyConditionExpression: "GSI1PK = :emailKey",
      ExpressionAttributeValues: {
        ":emailKey": `EMAIL#${email}`,
      },
    }).promise();

    if (existingUser.Items.length > 0) {
      console.warn("⚠️ User with this email already exists:", email);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Email already exists" }),
      };
    }

    // ✅ Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const timestamp = new Date().toISOString();

    // 🔐 Encrypt all user fields
    const encryptedValues = await encryptData({
      PK: `USER#${id}`,
      SK: "METADATA",
      GSI1PK: `EMAIL#${email}`,
      GSI1SK: `USER#${id}`,
      email,
      username,
      membershipTier,
    });

    // ✅ Construct final user object
    const newUser = {
      PK: encryptedValues.PK,
      SK: encryptedValues.SK,
      GSI1PK: encryptedValues.GSI1PK,
      GSI1SK: encryptedValues.GSI1SK,
      email: encryptedValues.email,
      username: encryptedValues.username,
      password: hashedPassword, // Store only hashed, not encrypted
      membershipTier: encryptedValues.membershipTier,
      createdAt: timestamp,
    };

    // ✅ Save user to DynamoDB
    await dynamoDB.put({
      TableName: USERS_TABLE,
      Item: newUser,
    }).promise();

    console.log("✅ User registered and encrypted successfully:", newUser);

    // 📤 Send SQS Message (plain)
    const sqsMessage = {
      id,
      email,
      username,
      membershipTier,
      eventType: "UserCreateEvent",
    };

    await sqs.sendMessage({
      QueueUrl: USER_QUEUE_URL,
      MessageBody: JSON.stringify(sqsMessage),
    }).promise();

    console.log("📨 User registration event sent to SQS:", sqsMessage);

    return {
      statusCode: 201,
      body: JSON.stringify({ message: "User registered successfully" }),
    };
  } catch (error) {
    console.error("❌ Error registering user:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Could not register user",
        debug_message: error.message,
        debug_stack: error.stack,
      }),
    };
  }
};
