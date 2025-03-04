const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();

// Use the existing "Templates" table
const TABLE_NAME = process.env.TEMPLATES_TABLE_NAME || "Templates";
const QUEUE_URL = process.env.TEMPLATE_QUEUE_URL;
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
        const { id, type, name, content, variables, status, metadata, adminId } = body;

        if (!id || !type || !name || !content || !variables || !status || !metadata || !adminId) {
            console.error("Error: Missing required fields.");
            return { statusCode: 400, body: JSON.stringify({ message: "Missing required fields: id, type, name, content, variables, status, metadata, adminId" }) };
        }

        console.log("Valid request. Preparing to insert/update in DynamoDB...");

        // Construct item for DynamoDB
        const updatedAt = Date.now();
        const item = {
            PK: `TEMPLATE#${id}`,
            SK: type,
            templateId: id,
            type,
            name,
            content,
            variables,
            status,
            metadata,
            updatedBy: adminId,
            updatedAt,
        };

        console.log("DynamoDB Item to Insert:", JSON.stringify(item, null, 2));

        // Insert into DynamoDB
        try {
            await dynamoDB.put({ TableName: TABLE_NAME, Item: item }).promise();
            console.log("DynamoDB Inserted/Updated Successfully");
        } catch (dbError) {
            console.error("DynamoDB Insert/Update Failed:", JSON.stringify(dbError, null, 2));
            return {
                statusCode: 500,
                body: JSON.stringify({ message: "DynamoDB Insert/Update Failed", error: dbError.message }),
            };
        }

        // Send Message to SQS if Queue URL is set
        if (QUEUE_URL) {
            try {
                console.log("Attempting to send message to SQS...");
                await sqs.sendMessage({
                    QueueUrl: QUEUE_URL,
                    MessageBody: JSON.stringify({ id, type, name, status, action: "update_template" }),
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
                        Source: "notifications.service",
                        DetailType: "TemplateEvent",
                        Detail: JSON.stringify({ id, type, name, status }),
                        EventBusName: EVENT_BUS_NAME,
                    },
                ],
            }).promise();
            console.log("EventBridge Triggered:", id);
        } catch (eventError) {
            console.error("EventBridge Event Failed:", JSON.stringify(eventError, null, 2));
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Notification template updated successfully", id }),
        };
    } catch (error) {
        console.error("Unexpected Error:", JSON.stringify(error, null, 2));
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};
