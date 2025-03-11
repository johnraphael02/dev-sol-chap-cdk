const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const { v4: uuidv4 } = require('uuid');
const lambda = new AWS.Lambda();
const sqs = new AWS.SQS();

const TABLE_NAME = process.env.MESSAGES_TABLE || "Dev-Messages";
const REVIEW_QUEUE_URL = process.env.REVIEW_QUEUE_URL;
const DECRYPTION_LAMBDA = "sol-chap-decryption";

exports.handler = async (event) => {
  try {
    // Fetch messages with status = PENDING
    const params = {
      TableName: TABLE_NAME,
      FilterExpression: "begins_with(PK, :messagePrefix) AND #status = :pending",
      ExpressionAttributeNames: {
        "#status": "status" // Use ExpressionAttributeNames for reserved words
      },
      ExpressionAttributeValues: {
        ":messagePrefix": "MESSAGE#",
        ":pending": "PENDING"
      }
    };

    const data = await dynamoDB.scan(params).promise();
    let messages = data.Items || [];

    console.log(`🔍 Retrieved ${messages.length} PENDING messages.`);

    // Decrypt each message
    for (let message of messages) {
      try {
        const decryptionResponse = await lambda.invoke({
          FunctionName: DECRYPTION_LAMBDA,
          InvocationType: "RequestResponse",
          Payload: JSON.stringify({
            body: JSON.stringify({
              senderId: message.senderId,
              receiverId: message.receiverId,
              message: message.message,
              subject: message.subject,
              policy: message.policy,
            }),
          }),
        }).promise();

        const decryptionResult = JSON.parse(decryptionResponse.Payload || '{}');

        if (decryptionResult.statusCode !== 200 || !decryptionResult.body) {
          throw new Error("Invalid response from decryption lambda");
        }

        const decryptedData = JSON.parse(decryptionResult.body).decryptedData;

        if (!decryptedData) {
          throw new Error("Missing decryptedData in response");
        }

        // Update message with decrypted values
        message.senderId = decryptedData.senderId;
        message.receiverId = decryptedData.receiverId;
        message.message = decryptedData.message;
        message.subject = decryptedData.subject;
        message.policy = decryptedData.policy;
        message.GSI2PK = decryptedData.receiverId;
      } catch (decryptionError) {
        console.error("❌ Decryption error for message:", message.PK, decryptionError.message);
        continue; // Skip sending this message to SQS if decryption fails
      }
    }

    // Send decrypted messages to SQS
    for (const message of messages) {
      const sqsParams = {
        QueueUrl: REVIEW_QUEUE_URL,
        MessageBody: JSON.stringify(message),
      };

      try {
        await sqs.sendMessage(sqsParams).promise();
        console.log(`📤 Sent message ${message.PK} to SQS`);
      } catch (sqsError) {
        console.error(`❌ Failed to send message ${message.PK} to SQS`, sqsError);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ messages, message: "Decrypted messages sent to SQS" }),
    };
  } catch (error) {
    console.error("🚨 Error fetching, decrypting, and sending pending messages:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to process pending messages" }),
    };
  }
};
