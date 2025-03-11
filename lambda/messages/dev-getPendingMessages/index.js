const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();
const sqs = new AWS.SQS();

const TABLE_NAME = process.env.MESSAGES_TABLE;
const REVIEW_QUEUE_URL = process.env.REVIEW_QUEUE_URL;
const decryptionFunction = "sol-chap-decryption";

exports.handler = async () => {
  try {
    // Fetch pending messages using GSI (efficient query)
    const params = {
      TableName: TABLE_NAME,
      IndexName: "GSI1", // Ensure this GSI exists with status as GSI1PK
      KeyConditionExpression: "GSI1PK = :pending",
      ExpressionAttributeValues: {
        ":pending": "PENDING",
      },
    };

    const data = await dynamoDB.query(params).promise();
    let messages = data.Items || [];

    if (messages.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: "No pending messages found" }),
      };
    }

    // Batch decrypt messages
    const decryptionResponse = await lambda.invoke({
      FunctionName: decryptionFunction,
      Payload: JSON.stringify({ data: messages }),
    }).promise();

    const decryptionResult = JSON.parse(decryptionResponse.Payload);
    const decryptedMessages = JSON.parse(decryptionResult.body).decryptedData?.data || [];

    // Send each decrypted message to SQS
    for (const message of decryptedMessages) {
      const sqsParams = {
        QueueUrl: REVIEW_QUEUE_URL,
        MessageBody: JSON.stringify(message),
      };
      await sqs.sendMessage(sqsParams).promise();
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ messages: decryptedMessages, message: "Decrypted messages sent to SQS" }),
    };
  } catch (error) {
    console.error("Error fetching, decrypting, and sending pending messages:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to process pending messages" }),
    };
  }
};
