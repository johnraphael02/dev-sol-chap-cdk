const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

const encryptionFunction = process.env.ENCRYPTION_FUNCTION || "sol-chap-encryption";
const TABLE_NAME = process.env.MESSAGES_TABLE_NAME || "Dev-Messages";
const QUEUE_URL = process.env.CIRCUMVENT_QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";

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

        const { id, circumventDetected, adminId } = body;
        if (!id || circumventDetected === undefined || !adminId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Missing required fields: id, circumventDetected, adminId" }),
            };
        }

        let encryptedData;
        try {
            const encryptionResponse = await lambda.invoke({
                FunctionName: encryptionFunction,
                InvocationType: "RequestResponse",
                Payload: JSON.stringify({
                    data: { id, circumventDetected, adminId, PK: `MESSAGE#${id}`, SK: "CIRCUMVENT" }
                })
            }).promise();

            const encryptionResult = JSON.parse(encryptionResponse.Payload);
            const parsedEncryptionBody = JSON.parse(encryptionResult.body);
            encryptedData = parsedEncryptionBody.encryptedData?.data;

            if (!encryptedData || !encryptedData.id || encryptedData.circumventDetected === undefined || !encryptedData.adminId || !encryptedData.PK || !encryptedData.SK) {
                throw new Error("Encryption failed: Missing encrypted fields");
            }
        } catch (encryptionError) {
            console.error("Encryption error:", encryptionError);
            return { statusCode: 500, body: JSON.stringify({ message: "Encryption failed" }) };
        }

        console.log("Encrypted data received:", JSON.stringify(encryptedData, null, 2));

        const checkedAt = new Date().toISOString();
        const item = {
            PK: encryptedData.PK,
            SK: encryptedData.SK,
            GSI1PK: "STATUS#CIRCUMVENTED",
            GSI1SK: `CREATED_AT#${checkedAt}`,
            circumventDetected: encryptedData.circumventDetected,
            checkedBy: encryptedData.adminId,
            checkedAt,
        };

        try {
            await dynamoDB.put({ TableName: TABLE_NAME, Item: item }).promise();
        } catch (dbError) {
            return {
                statusCode: 500,
                body: JSON.stringify({ message: "DynamoDB Insert Failed", error: dbError.message }),
            };
        }

        if (QUEUE_URL) {
            try {
                await sqs.sendMessage({
                    QueueUrl: QUEUE_URL,
                    MessageBody: JSON.stringify({
                        id: encryptedData.id,
                        circumventDetected: encryptedData.circumventDetected,
                        adminId: encryptedData.adminId,
                        action: "circumvent_check"
                    }),
                }).promise();
            } catch (sqsError) {
                console.error("SQS Message Send Failed:", JSON.stringify(sqsError, null, 2));
            }
        }

        try {
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
        } catch (eventError) {
            console.error("EventBridge Event Failed:", JSON.stringify(eventError, null, 2));
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Circumvention check recorded", id: encryptedData.id, circumventDetected: encryptedData.circumventDetected }),
        };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
