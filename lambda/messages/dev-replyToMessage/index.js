const AWS = require('aws-sdk');

const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();
const encryptionFunction = "aes-encryption";

const tableName = process.env.MESSAGE_TABLE;
const FILTER_QUEUE_URL = process.env.FILTER_QUEUE_URL;
const REPLY_QUEUE_URL = process.env.REPLY_QUEUE_URL;

exports.handler = async (event) => {
    try {
        console.log("Received event:", JSON.stringify(event, null, 2));

        let body;
        try {
            body = JSON.parse(event.body);
        } catch (parseError) {
            console.error("Invalid JSON in request body:", parseError);
            return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON format" }) };
        }

        const messageId = event.pathParameters.id;
        const { senderId, receiverId, messageText, replyText } = body;

        if (!messageId || !senderId || !receiverId || (!messageText && !replyText)) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields" }) };
        }

        const timestamp = new Date().toISOString();

        // Encrypt fields
        const encryptionResponse = await lambda.invoke({
            FunctionName: encryptionFunction,
            Payload: JSON.stringify({
                data: { messageId, senderId, receiverId, messageText, replyText }
            })
        }).promise();

        const encryptionResult = JSON.parse(encryptionResponse.Payload);
        const encryptedData = JSON.parse(encryptionResult.body).encryptedData?.data;

        if (!encryptedData) {
            throw new Error("Encryption failed");
        }

        // Store the reply in DynamoDB
        const pk = `MESSAGE#${encryptedData.messageId}`;
        const skReplies = `REPLIES#${timestamp}`;

        await dynamoDB.put({
            TableName: tableName,
            Item: {
                PK: pk,
                SK: skReplies,
                replyText: encryptedData.replyText,
                senderId: encryptedData.senderId,
                receiverId: encryptedData.receiverId,
                timestamp,
                GSI2PK: `USER#${encryptedData.receiverId}`,
                GSI2SK: `CREATED_AT#${timestamp}`
            }
        }).promise();

        // Send event to SQS queue
        await sqs.sendMessage({
            QueueUrl: REPLY_QUEUE_URL,
            MessageBody: JSON.stringify({
                messageId: encryptedData.messageId,
                replyText: encryptedData.replyText,
                senderId: encryptedData.senderId,
                receiverId: encryptedData.receiverId
            })
        }).promise();

        // Publish event to EventBridge
        await eventBridge.putEvents({
            Entries: [
                {
                    Source: "aws.messages",
                    DetailType: "ReplyToMessage",
                    Detail: JSON.stringify({
                        messageId: encryptedData.messageId,
                        replyText: encryptedData.replyText,
                        senderId: encryptedData.senderId,
                        receiverId: encryptedData.receiverId
                    })
                }
            ]
        }).promise();

        return { statusCode: 200, body: JSON.stringify({ message: "Reply processed successfully" }) };
    } catch (error) {
        console.error("Lambda Error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
