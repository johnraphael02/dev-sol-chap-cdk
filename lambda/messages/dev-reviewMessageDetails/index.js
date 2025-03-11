const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

const TABLE_NAME = process.env.MESSAGES_TABLE_NAME || "Dev-Messages";
const QUEUE_URL = process.env.DETAIL_QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";

exports.handler = async (event) => {
    try {
        console.log("Received event:", JSON.stringify(event, null, 2));

        // Safely parse the request body
        let body;
        try {
            body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
        } catch (parseError) {
            console.error("JSON Parse Error:", parseError);
            return { statusCode: 400, body: JSON.stringify({ message: "Invalid JSON format" }) };
        }
        console.log("Parsed request body:", body);

        // Extract required fields based on the schema:
        // { "id": "12345", "fromUserId": "userA", "toUserId": "userB", "notes": "Reviewed for compliance", "adminId": "admin987" }
        const { id, fromUserId, toUserId, notes, adminId } = body;
        if (!id || !fromUserId || !toUserId || !notes || !adminId) {
            console.error("Error: Missing required fields.");
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Missing required fields: id, fromUserId, toUserId, notes, adminId" }),
            };
        }

        console.log("Valid request. Preparing to encrypt sensitive fields...");

        // Encrypt sensitive fields using the helper function (pattern from your reference code)
        const encryptedNotes = await encryptText(notes);
        const encryptedAdminId = await encryptText(adminId);
        console.log("Encryption completed for notes and adminId.");

        // Construct DynamoDB item using the "Messages" table schema
        const reviewedAt = new Date().toISOString();
        const item = {
            PK: `MESSAGE#${id}`,
            SK: "DETAILS",
            GSI1PK: `USER#${fromUserId}`,
            GSI1SK: `CREATED_AT#${reviewedAt}`,
            GSI2PK: `USER#${toUserId}`,
            GSI2SK: `CREATED_AT#${reviewedAt}`,
            fromUserId,
            toUserId,
            notes: encryptedNotes,       // Store the encrypted notes
            reviewedBy: encryptedAdminId,  // Store the encrypted adminId
            reviewedAt,
        };

        console.log("DynamoDB Item to Insert:", JSON.stringify(item, null, 2));

        // Save the item to DynamoDB
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

        // Send Message to SQS if a Queue URL is provided
        if (QUEUE_URL) {
            try {
                console.log("Attempting to send message to SQS...");
                await sqs.sendMessage({
                    QueueUrl: QUEUE_URL,
                    MessageBody: JSON.stringify({ id, fromUserId, toUserId, notes, adminId, action: "review_details" }),
                }).promise();
                console.log("SQS Message Sent:", id);
            } catch (sqsError) {
                console.error("SQS Message Send Failed:", JSON.stringify(sqsError, null, 2));
            }
        }

        // Trigger an EventBridge event
        try {
            console.log("Attempting to send event to EventBridge...");
            await eventBridge.putEvents({
                Entries: [
                    {
                        Source: "messages.service",
                        DetailType: "DetailEvent",
                        Detail: JSON.stringify({ id, fromUserId, toUserId, notes, adminId }),
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
            body: JSON.stringify({ message: "Message details review recorded", id }),
        };
    } catch (error) {
        console.error("Unexpected Error:", JSON.stringify(error, null, 2));
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};

// Helper function for encryption, following the same pattern as your reference code
async function encryptText(text) {
    try {
        const encryptionPayload = {
            FunctionName: "sol-chap-encryption",
            InvocationType: "RequestResponse",
            Payload: JSON.stringify({ body: JSON.stringify({ text }) }),
        };

        const encryptionResponse = await lambda.invoke(encryptionPayload).promise();
        console.log("🔹 Full Encryption Lambda Response:", encryptionResponse);

        if (!encryptionResponse.Payload) {
            throw new Error("Encryption Lambda did not return any payload.");
        }

        let encryptedData;
        try {
            encryptedData = JSON.parse(encryptionResponse.Payload);
        } catch (parseError) {
            throw new Error("Failed to parse Encryption Lambda response.");
        }

        console.log("Parsed Encryption Response:", encryptedData);

        if (encryptedData.statusCode >= 400) {
            throw new Error("Encryption Lambda returned an error status.");
        }

        const parsedBody = JSON.parse(encryptedData.body);
        if (!parsedBody.encryptedData || !parsedBody.encryptedData.text) {
            throw new Error("Encryption Lambda response is missing 'encryptedData.text'.");
        }

        return parsedBody.encryptedData.text;
    } catch (error) {
        console.error("Encryption error:", error);
        throw error;  // Stop execution if encryption fails
    }
}