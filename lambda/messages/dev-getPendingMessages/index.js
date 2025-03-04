const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const { v4: uuidv4 } = require('uuid');
const lambda = new AWS.Lambda();
const sqs = new AWS.SQS();

const TABLE_NAME = process.env.MESSAGES_TABLE;
const REVIEW_QUEUE_URL = process.env.REVIEW_QUEUE_URL;
const decryptionFunction = "aes-decryption";

exports.handler = async (event) => {
  try {
    // Fetch pending messages from DynamoDB
    const params = {
      TableName: TABLE_NAME,
      FilterExpression: "begins_with(PK, :messagePrefix) AND SK = :pending",
      ExpressionAttributeValues: {
        ":messagePrefix": "MESSAGE#",
        ":pending": "STATUS#PENDING",
      },
    };

    const data = await dynamoDB.scan(params).promise();
    let messages = data.Items || [];

    // Decrypt each message
    for (let message of messages) {
      try {
        const decryptionResponse = await lambda.invoke({
          FunctionName: decryptionFunction,
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

        const decryptionResult = JSON.parse(decryptionResponse.Payload);
        const decryptedData = JSON.parse(decryptionResult.body).decryptedData?.data;

        if (!decryptedData) {
          throw new Error("Decryption failed");
        }

        // Update message with decrypted values
        message.senderId = decryptedData.senderId;
        message.receiverId = decryptedData.receiverId;
        message.message = decryptedData.message;
        message.subject = decryptedData.subject;
        message.policy = decryptedData.policy;
        message.GSI2PK = decryptedData.receiverId;
      } catch (decryptionError) {
        console.error("Decryption error:", decryptionError);
        continue; // Skip sending this message to SQS if decryption fails
      }
    }

    // Send each decrypted message to SQS
    for (const message of messages) {
      const sqsParams = {
        QueueUrl: REVIEW_QUEUE_URL,
        MessageBody: JSON.stringify(message),
      };
      await sqs.sendMessage(sqsParams).promise();
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ messages, message: "Decrypted messages sent to SQS" }),
    };
  } catch (error) {
    console.error("Error fetching, decrypting, and sending pending messages:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to process pending messages" }),
    };
  }
};
