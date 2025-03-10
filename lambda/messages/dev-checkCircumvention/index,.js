const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

// Use environment variable for encryption function (defaults to "aes-encryption")
const encryptionFunction = process.env.ENCRYPTION_FUNCTION || "sol-chap-encryption";
const TABLE_NAME = process.env.MESSAGES_TABLE_NAME || "Messages";
const QUEUE_URL = process.env.CIRCUMVENT_QUEUE_URL;
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
        const { id, circumventDetected, adminId } = body;
        if (!id || circumventDetected === undefined || !adminId) {
            console.error("Error: Missing required fields.");
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Missing required fields: id, circumventDetected, adminId" }),
            };
        }

        // Invoke the encryption Lambda to encrypt sensitive fields
        let encryptedData;
        try {
            const encryptionResponse = await lambda.invoke({
                FunctionName: encryptionFunction,
                InvocationType: "RequestResponse",
                Payload: JSON.stringify({
                    data: { id, circumventDetected, adminId }
                })
            }).promise();

            console.log("Encryption Lambda response:", encryptionResponse);
            const encryptionResult = JSON.parse(encryptionResponse.Payload);
            const parsedEncryptionBody = JSON.parse(encryptionResult.body);
            encryptedData = parsedEncryptionBody.encryptedData?.data;

            if (!encryptedData || !encryptedData.id || encryptedData.circumventDetected === undefined || !encryptedData.adminId) {
                throw new Error("Encryption failed: Missing encrypted fields");
            }
        } catch (encryptionError) {
            console.error("Encryption error:", encryptionError);
            return { statusCode: 500, body: JSON.stringify({ message: "Encryption failed" }) };
        }

        console.log("Encrypted data received:", JSON.stringify(encryptedData, null, 2));

        console.log("Valid request. Preparing to insert into DynamoDB...");

        // Construct item for DynamoDB using encrypted values
        const checkedAt = new Date().toISOString();
        const item = {
            PK: `MESSAGE#${encryptedData.id}`,
            SK: "CIRCUMVENT",
            GSI1PK: `STATUS#CIRCUMVENTED`,
            GSI1SK: `CREATED_AT#${checkedAt}`,
            circumventDetected: encryptedData.circumventDetected,
            checkedBy: encryptedData.adminId,
            checkedAt,
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
                    MessageBody: JSON.stringify({
                        id: encryptedData.id,
                        circumventDetected: encryptedData.circumventDetected,
                        adminId: encryptedData.adminId,
                        action: "circumvent_check"
                    }),
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
                        DetailType: "CircumventEvent",
                        Detail: JSON.stringify({
                            id: encryptedData.id,
                            circumventDetected: encryptedData.circumventDetected,
                            adminId: encryptedData.adminId
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
            body: JSON.stringify({ message: "Circumvention check recorded", id: encryptedData.id, circumventDetected: encryptedData.circumventDetected }),
        };
    } catch (error) {
        console.error("Unexpected Error:", JSON.stringify(error, null, 2));
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
