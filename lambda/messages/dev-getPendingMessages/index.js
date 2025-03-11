const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const { v4: uuidv4 } = require('uuid');
const lambda = new AWS.Lambda();
const sqs = new AWS.SQS();

const TABLE_NAME = process.env.MESSAGES_TABLE;
const REVIEW_QUEUE_URL = process.env.REVIEW_QUEUE_URL;
const ENCRYPTION_FUNCTION = 'sol-chap-encryption'; // 👈 Use encryption Lambda
const DECRYPTION_FUNCTION = 'sol-chap-decryption';

exports.handler = async (event) => {
  try {
    // 🔐 Encrypt "STATUS#PENDING" first
    const encryptResponse = await lambda.invoke({
      FunctionName: ENCRYPTION_FUNCTION,
      Payload: JSON.stringify({ status: 'STATUS#PENDING' }),
    }).promise();

    const encryptPayload = JSON.parse(encryptResponse.Payload || '{}');
    const encryptBody = typeof encryptPayload.body === 'string'
      ? JSON.parse(encryptPayload.body)
      : encryptPayload.body;

    const encryptedPendingStatus = encryptBody?.encryptedData?.status;

    if (!encryptedPendingStatus) {
      throw new Error('Failed to encrypt STATUS#PENDING');
    }

    // ✅ Scan messages with encrypted STATUS#PENDING
    const scanParams = {
      TableName: TABLE_NAME,
      FilterExpression: "begins_with(PK, :messagePrefix) AND SK = :pending",
      ExpressionAttributeValues: {
        ":messagePrefix": "MESSAGE#",
        ":pending": encryptedPendingStatus,
      },
    };

    const data = await dynamoDB.scan(scanParams).promise();
    let messages = data.Items || [];

    // ✅ Decrypt each message before sending to SQS
    for (let message of messages) {
      try {
        const decryptionResponse = await lambda.invoke({
          FunctionName: DECRYPTION_FUNCTION,
          Payload: JSON.stringify({
            data: {
              senderId: message.senderId,
              receiverId: message.receiverId,
              message: message.message,
              subject: message.subject,
              policy: message.policy,
            },
          }),
        }).promise();

        const decryptionPayload = JSON.parse(decryptionResponse.Payload || '{}');
        const body = typeof decryptionPayload.body === 'string'
          ? JSON.parse(decryptionPayload.body)
          : decryptionPayload.body;

        const decryptedData = body?.decryptedData?.data;

        if (!decryptedData) {
          throw new Error('Decryption failed or missing decrypted data');
        }

        // Replace encrypted values with decrypted
        message.senderId = decryptedData.senderId;
        message.receiverId = decryptedData.receiverId;
        message.message = decryptedData.message;
        message.subject = decryptedData.subject;
        message.policy = decryptedData.policy;
        message.GSI2PK = decryptedData.receiverId;

      } catch (decryptionError) {
        console.error("❌ Decryption error:", decryptionError);
        continue; // skip this message if decryption fails
      }
    }

    // ✅ Send decrypted messages to SQS
    for (const message of messages) {
      const sqsParams = {
        QueueUrl: REVIEW_QUEUE_URL,
        MessageBody: JSON.stringify(message),
      };
      await sqs.sendMessage(sqsParams).promise();
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Successfully fetched, decrypted, and sent pending messages to SQS.",
        count: messages.length,
        messages,
      }),
    };

  } catch (error) {
    console.error("❌ Error in processing pending messages:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to process pending messages", details: error.message }),
    };
  }
};