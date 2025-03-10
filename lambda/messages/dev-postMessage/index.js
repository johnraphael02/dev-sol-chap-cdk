const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const { v4: uuidv4 } = require('uuid');
const lambda = new AWS.Lambda();

const TABLE_NAME = process.env.MESSAGES_TABLE;
const encryptionFunction = "sol-chap-encryption";

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

    // Encrypt all fields, including PK and SK
    const encryptionResponse = await lambda.invoke({
      FunctionName: encryptionFunction,
      Payload: JSON.stringify({
        data: { 
          PK: `MESSAGE#${messageId}`, 
          SK: `STATUS#PENDING`,
          senderId, 
          receiverId, 
          message, 
          subject, 
          policy 
        }
      })
    }).promise();

    const encryptionResult = JSON.parse(encryptionResponse.Payload);
    const encryptedData = JSON.parse(encryptionResult.body).encryptedData?.data;

    if (!encryptedData) {
      throw new Error("Encryption failed");
    }

    // Store encrypted values in DynamoDB
    const params = {
      TableName: TABLE_NAME,
      Item: {
        PK: encryptedData.PK, // Encrypted PK
        SK: encryptedData.SK, // Encrypted SK
        senderId: encryptedData.senderId,
        receiverId: encryptedData.receiverId,
        message: encryptedData.message,
        subject: encryptedData.subject,
        policy: encryptedData.policy,
        timestamp,  // Only timestamp remains unencrypted
        status: "PENDING",
        GSI1PK: encryptedData.SK, // Using encrypted SK as status index
        GSI1SK: `CREATED_AT#${timestamp}`,
        GSI2PK: encryptedData.receiverId,
        GSI2SK: `CREATED_AT#${timestamp}`,
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
