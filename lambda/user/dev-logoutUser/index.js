const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();

// Environment variables
const TABLE_NAME = process.env.USERS_TABLE_NAME || "Dev-Users";
const QUEUE_URL = process.env.AUTH_QUEUE_URL; // SQS Queue
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default"; // EventBridge Rule

exports.handler = async (event) => {
    console.log("Received event:", JSON.stringify(event, null, 2));

    try {
        // Parse the event body if it's a string
        const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
        console.log("Parsed request body:", body);

        // Extract userId and email
        const { userId, email } = body || {}; // Ensure body is defined

        if (!userId || !email) {
            console.error("Error: Missing required fields.");
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Missing required fields: userId, email" }),
            };
        }

        console.log(`Processing logout for user: ${userId}`);

        // Step 1: Update session data in DynamoDB (change event from LOGIN to LOGOUT)
        try {
            await dynamoDB.update({
                TableName: TABLE_NAME,
                Key: { PK: userId, SK: "SESSION" },
                UpdateExpression: "SET #event = :logout, updatedAt = :timestamp",
                ExpressionAttributeNames: { "#event": "event" },
                ExpressionAttributeValues: {
                    ":logout": "LOGOUT",
                    ":timestamp": new Date().toISOString(),
                },
            }).promise();

            console.log(`DynamoDB Session Updated for User ID: ${userId}`);
        } catch (dbError) {
            console.error("DynamoDB Session Update Failed:", JSON.stringify(dbError, null, 2));
            return {
                statusCode: 500,
                body: JSON.stringify({ message: "DynamoDB Session Update Failed", error: dbError.message }),
            };
        }

        // Step 2: Send Message to SQS if Queue URL is set
        if (QUEUE_URL) {
            try {
                console.log("Attempting to send message to SQS...");
                await sqs.sendMessage({
                    QueueUrl: QUEUE_URL,
                    MessageBody: JSON.stringify({ userId, action: "logout" }),
                }).promise();
                console.log("SQS Message Sent:", userId);
            } catch (sqsError) {
                console.error("SQS Message Send Failed:", JSON.stringify(sqsError, null, 2));
            }
        }

        // Step 3: Trigger EventBridge Event
        try {
            console.log("Attempting to send event to EventBridge...");
            await eventBridge.putEvents({
                Entries: [
                    {
                        Source: "auth.service",
                        DetailType: "LogoutEvent",
                        Detail: JSON.stringify({ userId, email }),
                        EventBusName: EVENT_BUS_NAME,
                    },
                ],
            }).promise();
            console.log("EventBridge Triggered:", userId);
        } catch (eventError) {
            console.error("EventBridge Event Failed:", JSON.stringify(eventError, null, 2));
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "User successfully logged out", userId }),
        };
    } catch (error) {
        console.error("Unexpected Error:", JSON.stringify(error, null, 2));
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Internal Server Error" }),
        };
    }
};
