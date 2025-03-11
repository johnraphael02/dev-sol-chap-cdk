const AWS = require("aws-sdk");
const bcrypt = require("bcryptjs");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const lambda = new AWS.Lambda();

const USERS_TABLE = "Dev-Users";
const SQS_QUEUE_URL = "https://sqs.ap-southeast-2.amazonaws.com/066926217034/Dev-UserQueue";
const EMAIL_INDEX = "Dev-EmailIndex";
const ENCRYPTION_LAMBDA = "sol-chap-encryption";

// 🔐 Helper to encrypt any field
const encryptField = async (fieldValue) => {
  const params = {
    FunctionName: ENCRYPTION_LAMBDA,
    InvocationType: "RequestResponse",
    Payload: JSON.stringify({
      body: JSON.stringify({ text: fieldValue }),
    }),
  };

  try {
    const response = await lambda.invoke(params).promise();
    const parsed = JSON.parse(response.Payload);
    const encrypted = JSON.parse(parsed.body).encryptedData;

    if (!encrypted) throw new Error("Missing encryptedData from encryption Lambda");
    return encrypted;
  } catch (error) {
    console.error("🔐 Encryption Error:", error.message);
    throw error;
  }
};

exports.handler = async (event) => {
  try {
    console.log("📩 Register Event Received:", event.body);

    const requestBody = JSON.parse(event.body);
    const { id, email, password, username, membershipTier } = requestBody;

    // 📌 Validate required fields
    if (!id || !email || !password || !username || !membershipTier) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required fields" }),
      };
    }

    // 🔍 Check if email already exists
    const existingUser = await dynamoDB.query({
      TableName: USERS_TABLE,
      IndexName: EMAIL_INDEX,
      KeyConditionExpression: "GSI1PK = :emailKey",
      ExpressionAttributeValues: {
        ":emailKey": `EMAIL#${email}`,
      },
    }).promise();

    if (existingUser.Items.length > 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Email already exists" }),
      };
    }

    // 🔐 Encrypt all fields including SK
    const [
      encryptedId,
      encryptedEmail,
      encryptedUsername,
      encryptedMembershipTier,
      encryptedSK
    ] = await Promise.all([
      encryptField(id),
      encryptField(email),
      encryptField(username),
      encryptField(membershipTier),
      encryptField("METADATA")
    ]);

    // 🔒 Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 🏗 Build new encrypted user record
    const newUser = {
      PK: `USER#${encryptedId}`,
      SK: encryptedSK,
      GSI1PK: `EMAIL#${encryptedEmail}`,
      GSI1SK: `USER#${encryptedId}`,
      email: encryptedEmail,
      username: encryptedUsername,
      password: hashedPassword,
      membershipTier: encryptedMembershipTier,
      createdAt: new Date().toISOString(),
    };

    // 💾 Store to DynamoDB
    await dynamoDB.put({
      TableName: USERS_TABLE,
      Item: newUser,
    }).promise();

    console.log("✅ Encrypted User Saved:", newUser);

    // 📤 Send to SQS (plain values)
    const sqsPayload = {
      id,
      email,
      username,
      membershipTier,
      eventType: "UserCreateEvent",
    };

    await sqs.sendMessage({
      QueueUrl: SQS_QUEUE_URL,
      MessageBody: JSON.stringify(sqsPayload),
    }).promise();

    console.log("📨 Sent UserCreateEvent to SQS:", sqsPayload);

    return {
      statusCode: 201,
      body: JSON.stringify({ message: "User registered successfully" }),
    };

  } catch (error) {
    console.error("❌ User Registration Failed:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Could not register user",
        details: error.message,
      }),
    };
  }
};
