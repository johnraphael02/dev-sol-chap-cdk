const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

const encryptionFunction = "sol-chap-encryption"; // Encryption Lambda function
const TABLE_NAME = process.env.MESSAGES_TABLE_NAME || "Dev-Messages";
const QUEUE_URL = process.env.REVIEW_QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";

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
        const { id, status, adminId } = body;

        if (!id || !status || !adminId) {
            console.error("Error: Missing required fields.");
            return { statusCode: 400, body: JSON.stringify({ message: "Missing required fields: id, status, adminId" }) };
        }

        // Allowed status values
        const allowedStatuses = ["approved", "rejected", "pending"];
        if (!allowedStatuses.includes(status.toLowerCase())) {
            console.error("Error: Invalid status value.");
            return {
                statusCode: 400,
                body: JSON.stringify({ message: `Invalid status: ${status}. Allowed values: ${allowedStatuses.join(", ")}` }),
            };
        }

        console.log("Valid request. Encrypting data...");

        // Encrypt fields before storing
        const encryptionResponse = await lambda.invoke({
            FunctionName: encryptionFunction,
            Payload: JSON.stringify({
                data: { id, status, adminId }
            }),
        }).promise();

        const encryptionResult = JSON.parse(encryptionResponse.Payload);
        const encryptedData = JSON.parse(encryptionResult.body).encryptedData?.data;

        if (!encryptedData) {
            throw new Error("Encryption failed");
        }

        // Construct item for DynamoDB
        const reviewedAt = new Date().toISOString();
        const item = {
            PK: `MESSAGE#${encryptedData.id}`,
            SK: "STATUS",
            GSI1PK: `STATUS#${encryptedData.status}`,
            GSI1SK: `CREATED_AT#${reviewedAt}`,
            status: encryptedData.status,
            reviewedBy: encryptedData.adminId,
            reviewedAt,
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
                    MessageBody: JSON.stringify({ id: encryptedData.id, status: encryptedData.status, adminId: encryptedData.adminId, action: "review" }),
                }).promise();
                console.log("SQS Message Sent:", encryptedData.id);
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
                        DetailType: "ReviewEvent",
                        Detail: JSON.stringify({ id: encryptedData.id, status: encryptedData.status, adminId: encryptedData.adminId }),
                        EventBusName: EVENT_BUS_NAME,
                    },
                ],
            }).promise();
            console.log("EventBridge Triggered:", encryptedData.id);
        } catch (eventError) {
            console.error("EventBridge Event Failed:", JSON.stringify(eventError, null, 2));
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Message review recorded", id: encryptedData.id, status: encryptedData.status }),
        };
    } catch (error) {
        console.error("Unexpected Error:", JSON.stringify(error, null, 2));
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};
