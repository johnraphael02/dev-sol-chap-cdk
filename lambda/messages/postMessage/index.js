const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const { v4: uuidv4 } = require('uuid');
const lambda = new AWS.Lambda();

const TABLE_NAME = process.env.MESSAGES_TABLE;
const encryptionFunction = "aes-encryption";

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);
    const { senderId, receiverId, message, subject, policy } = body;

    if (!senderId || !receiverId || !message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required fields" }),
      };
    }

    const timestamp = new Date().toISOString();
    const messageId = uuidv4();

    // Encrypt sensitive fields
    const encryptionResponse = await lambda.invoke({
      FunctionName: encryptionFunction,
      Payload: JSON.stringify({
        data: { senderId, receiverId, message, subject, policy }
      })
    }).promise();

    const encryptionResult = JSON.parse(encryptionResponse.Payload);
    const encryptedData = JSON.parse(encryptionResult.body).encryptedData?.data;

    if (!encryptedData) {
      throw new Error("Encryption failed");
    }

    // Unique partition key for the message
    const PK = `MESSAGE#${messageId}`;
    // Sort key set to "STATUS#PENDING"
    const SK = `STATUS#PENDING`;

    // Setting status to "PENDING"
    const status = "PENDING";

    const params = {
      TableName: TABLE_NAME,
      Item: {
        PK,
        SK,  // Set SK to STATUS#PENDING
        senderId: encryptedData.senderId,
        receiverId: encryptedData.receiverId,
        message: encryptedData.message,
        subject: encryptedData.subject,  // Encrypted Subject (if applicable)
        policy: encryptedData.policy,   // Encrypted Policy (if applicable)
        timestamp,
        status,  // Default status set to "PENDING"
        GSI1PK: `STATUS#PENDING`,  // GSI1PK for querying by status (set to "PENDING")
        GSI1SK: `CREATED_AT#${timestamp}`,  // GSI1SK for filtering by timestamp
        GSI2PK: `USER#${encryptedData.receiverId}`,  // GSI2PK for querying messages by userId
        GSI2SK: `CREATED_AT#${timestamp}`,  // GSI2SK for filtering by userId and timestamp
      },
    };

    await dynamoDB.put(params).promise();

    return {
      statusCode: 201,
      body: JSON.stringify({ message: "Message saved successfully", messageId }),
    };
  } catch (error) {
    console.error("Error saving message:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to save message" }),
    };
  }
};
