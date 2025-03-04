const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();

// Use the existing "Messages" table
const TABLE_NAME = process.env.MESSAGES_TABLE_NAME || "Messages";
const QUEUE_URL = process.env.MESSAGE_QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";
const COGNITO_POOL = process.env.COGNITO_POOL;

exports.handler = async (event) => {
    try {
        console.log("Received event:", JSON.stringify(event, null, 2));

        // Parse request body safely
        let body;
        try {
            body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
        } catch (parseError) {
            console.error("JSON Parse Error:", parseError);
            return { statusCode: 400, body: JSON.stringify({ message: "Invalid JSON format" }) };
        }

        console.log("Parsed request body:", body);

        // Extract required fields
        const { id, userId, content, status, timestamp } = body;

        if (!id || !userId || !content || !status) {
            console.error("Error: Missing required fields.");
            return { statusCode: 400, body: JSON.stringify({ message: "Missing required fields: id, userId, content, status" }) };
        }

        console.log("Valid request. Preparing to insert into DynamoDB...");

        // Construct item for DynamoDB
        const createdAt = timestamp || new Date().toISOString();
        const item = {
            PK: `MESSAGE#${id}`,
            SK: `USER#${userId}`,
            GSI1PK: `STATUS#${status}`,
            GSI1SK: `CREATED_AT#${createdAt}`,
            GSI2PK: `USER#${userId}`,
            GSI2SK: `CREATED_AT#${createdAt}`,
            content,
            status,
            timestamp: createdAt,
        };

        console.log("DynamoDB Item to Insert:", JSON.stringify(item, null, 2));

        // Insert into DynamoDB
        try {
            await dynamoDB.put({ TableName: TABLE_NAME, Item: item }).promise();
            console.log("DynamoDB Inserted Successfully");
        } catch (dbError) {
            console.error("DynamoDB Insert Failed:", JSON.stringify(dbError, null, 2));
            return {
                statusCode: 500,
                body: JSON.stringify({ message: "DynamoDB Insert Failed", error: dbError.message }),
            };
        }

        // Send Message to SQS if Queue URL is set
        if (QUEUE_URL) {
            try {
                console.log("Attempting to send message to SQS...");
                await sqs.sendMessage({
                    QueueUrl: QUEUE_URL,
                    MessageBody: JSON.stringify({ id, userId, content, status, action: "create" }),
                }).promise();
                console.log("SQS Message Sent:", id);
            } catch (sqsError) {
                console.error("SQS Message Send Failed:", JSON.stringify(sqsError, null, 2));
            }
        }

        // Trigger EventBridge Event
        try {
            console.log("Attempting to send event to EventBridge...");
            await eventBridge.putEvents({
                Entries: [
                    {
                        Source: "messages.service",
                        DetailType: "MessageCreateEvent",
                        Detail: JSON.stringify({ id, userId, content, status }),
                        EventBusName: EVENT_BUS_NAME,
                    },
                ],
            }).promise();
            console.log("EventBridge Triggered:", id);
        } catch (eventError) {
            console.error("EventBridge Event Failed:", JSON.stringify(eventError, null, 2));
        }

        return {
            statusCode: 201,
            body: JSON.stringify({ message: "Message created successfully", id }),
        };
    } catch (error) {
        console.error("Unexpected Error:", JSON.stringify(error, null, 2));
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};
