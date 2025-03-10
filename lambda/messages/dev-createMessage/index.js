const AWS = require("aws-sdk");
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

const TABLE_NAME = process.env.MESSAGES_TABLE_NAME || "Messages";
const QUEUE_URL = process.env.MESSAGE_QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";
const ENCRYPTION_LAMBDA = "sol-chap-encryption";

exports.handler = async (event) => {
    try {
        console.log("Received event:", JSON.stringify(event, null, 2));

        let body;
        try {
            body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
        } catch (parseError) {
            console.error("JSON Parse Error:", parseError);
            return { statusCode: 400, body: JSON.stringify({ message: "Invalid JSON format" }) };
        }

        console.log("Parsed request body:", body);

        const { id, userId, content, status, timestamp } = body;
        if (!id || !userId || !content || !status) {
            console.error("Error: Missing required fields.");
            return { statusCode: 400, body: JSON.stringify({ message: "Missing required fields: id, userId, content, status" }) };
        }

        const encryptedContent = await encryptText({ content });
        if (!encryptedContent) {
            throw new Error("Encryption failed for content");
        }

        console.log("Valid request. Preparing to insert into DynamoDB...");

        const createdAt = timestamp || new Date().toISOString();
        const item = {
            PK: `MESSAGE#${id}`,
            SK: `USER#${userId}`,
            GSI1PK: `STATUS#${status}`,
            GSI1SK: `CREATED_AT#${createdAt}`,
            GSI2PK: `USER#${userId}`,
            GSI2SK: `CREATED_AT#${createdAt}`,
            content: encryptedContent,
            status,
            timestamp: createdAt,
        };

        console.log("DynamoDB Item to Insert:", JSON.stringify(item, null, 2));

        await dynamoDB.put({ TableName: TABLE_NAME, Item: item }).promise();
        console.log("DynamoDB Inserted Successfully");

        if (QUEUE_URL) {
            try {
                console.log("Attempting to send message to SQS...");
                await sqs.sendMessage({
                    QueueUrl: QUEUE_URL,
                    MessageBody: JSON.stringify({ id, userId, content: encryptedContent, status, action: "create" }),
                }).promise();
                console.log("SQS Message Sent:", id);
            } catch (sqsError) {
                console.error("SQS Message Send Failed:", JSON.stringify(sqsError, null, 2));
            }
        }

        try {
            console.log("Attempting to send event to EventBridge...");
            await eventBridge.putEvents({
                Entries: [
                    {
                        Source: "messages.service",
                        DetailType: "MessageCreateEvent",
                        Detail: JSON.stringify({ id, userId, content: encryptedContent, status }),
                        EventBusName: EVENT_BUS_NAME,
                    },
                ],
            }).promise();
            console.log("EventBridge Triggered:", id);
        } catch (eventError) {
            console.error("EventBridge Event Failed:", JSON.stringify(eventError, null, 2));
        }

        return { statusCode: 201, body: JSON.stringify({ message: "Message created successfully", id }) };

    } catch (error) {
        console.error("Unexpected Error:", JSON.stringify(error, null, 2));
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

async function encryptText(data) {
    try {
        const encryptionPayload = {
            FunctionName: ENCRYPTION_LAMBDA,
            InvocationType: "RequestResponse",
            Payload: JSON.stringify({ body: JSON.stringify(data) }),
        };

        const encryptionResponse = await lambda.invoke(encryptionPayload).promise();
        console.log("Encryption Lambda Response:", encryptionResponse);

        if (!encryptionResponse.Payload) {
            throw new Error("Encryption Lambda did not return any payload.");
        }

        const encryptedData = JSON.parse(encryptionResponse.Payload);
        console.log("Parsed Encryption Response:", encryptedData);

        if (encryptedData.statusCode >= 400) {
            throw new Error("Encryption Lambda returned an error status.");
        }

        const parsedBody = JSON.parse(encryptedData.body);
        if (!parsedBody.encryptedData) {
            throw new Error("Encryption Lambda response is missing 'encryptedData'.");
        }

        return parsedBody.encryptedData.content;
    } catch (error) {
        console.error("Encryption error:", error);
        throw error;
    }
}