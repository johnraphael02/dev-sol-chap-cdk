const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

const TABLE_NAME = process.env.TEMPLATES_TABLE_NAME || "Templates";
const QUEUE_URL = process.env.TEMPLATE_QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";
// Use the encryption function name from environment or default to "aes-encryption"
const encryptionFunction = process.env.ENCRYPTION_FUNCTION || "sol-chap-encryption";

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

        // Extract required fields from the request body
        const { id, type, name, content, variables, status, metadata, adminId } = body;
        if (!id || !type || !name || !content || !variables || !status || !metadata || !adminId) {
            console.error("Error: Missing required fields.");
            return { statusCode: 400, body: JSON.stringify({ message: "Missing required fields: id, type, name, content, variables, status, metadata, adminId" }) };
        }

        // Encrypt the sensitive fields by invoking the encryption Lambda
        let encryptedData;
        try {
            const encryptionResponse = await lambda.invoke({
                FunctionName: encryptionFunction,
                InvocationType: "RequestResponse",
                Payload: JSON.stringify({
                    data: { id, type, name, content, variables, status, metadata, adminId }
                })
            }).promise();

            console.log("Encryption Lambda response:", encryptionResponse);
            const encryptionResult = JSON.parse(encryptionResponse.Payload);
            const parsedEncryptionBody = JSON.parse(encryptionResult.body);
            encryptedData = parsedEncryptionBody.encryptedData?.data;
            
            if (!encryptedData ||
                !encryptedData.id ||
                !encryptedData.type ||
                !encryptedData.name ||
                !encryptedData.content ||
                !encryptedData.variables ||
                !encryptedData.status ||
                !encryptedData.metadata ||
                !encryptedData.adminId) {
                throw new Error("Encryption failed: Missing encrypted fields");
            }
        } catch (encryptionError) {
            console.error("Encryption error:", encryptionError);
            return { statusCode: 500, body: JSON.stringify({ message: "Encryption failed" }) };
        }

        console.log("Encrypted data received:", JSON.stringify(encryptedData, null, 2));

        console.log("Valid request. Preparing to insert/update in DynamoDB...");
        const updatedAt = Date.now();
        // Construct the item for DynamoDB using the encrypted data
        const item = {
            PK: `TEMPLATE#${encryptedData.id}`,
            SK: encryptedData.type,
            templateId: encryptedData.id,
            type: encryptedData.type,
            name: encryptedData.name,
            content: encryptedData.content,
            variables: encryptedData.variables,
            status: encryptedData.status,
            metadata: encryptedData.metadata,
            updatedBy: encryptedData.adminId,
            updatedAt,
        };

        console.log("DynamoDB Item to Insert:", JSON.stringify(item, null, 2));

        // Insert the item into DynamoDB
        try {
            await dynamoDB.put({ TableName: TABLE_NAME, Item: item }).promise();
            console.log("DynamoDB Inserted/Updated Successfully");
        } catch (dbError) {
            console.error("DynamoDB Insert/Update Failed:", JSON.stringify(dbError, null, 2));
            return { statusCode: 500, body: JSON.stringify({ message: "DynamoDB Insert/Update Failed", error: dbError.message }) };
        }

        // Send a message to SQS (if configured) with selected encrypted fields
        if (QUEUE_URL) {
            try {
                console.log("Attempting to send message to SQS...");
                await sqs.sendMessage({
                    QueueUrl: QUEUE_URL,
                    MessageBody: JSON.stringify({
                        id: encryptedData.id,
                        type: encryptedData.type,
                        name: encryptedData.name,
                        status: encryptedData.status,
                        action: "update_template"
                    }),
                }).promise();
                console.log("SQS Message Sent:", encryptedData.id);
            } catch (sqsError) {
                console.error("SQS Message Send Failed:", JSON.stringify(sqsError, null, 2));
            }
        }

        // Trigger an EventBridge event with the encrypted data
        try {
            console.log("Attempting to send event to EventBridge...");
            await eventBridge.putEvents({
                Entries: [
                    {
                        Source: "notifications.service",
                        DetailType: "TemplateEvent",
                        Detail: JSON.stringify({
                            id: encryptedData.id,
                            type: encryptedData.type,
                            name: encryptedData.name,
                            status: encryptedData.status,
                        }),
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
            body: JSON.stringify({ message: "Notification template updated successfully", id: encryptedData.id }),
        };
    } catch (error) {
        console.error("Unexpected Error:", JSON.stringify(error, null, 2));
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
