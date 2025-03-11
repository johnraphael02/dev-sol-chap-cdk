const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

const TABLE_NAME = process.env.MESSAGES_TABLE_NAME || "Dev-Messages";
const QUEUE_URL = process.env.DETAIL_QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";
const ENCRYPTION_FUNCTION = "sol-chap-encryption"; // Encryption Lambda function

async function encryptData(data) {
    const params = {
        FunctionName: ENCRYPTION_FUNCTION,
        Payload: JSON.stringify({ data }),
    };
    const response = await lambda.invoke(params).promise();
    try {
        const encryptedData = JSON.parse(response.Payload);
        if (!encryptedData.encrypted) throw new Error("Encryption function returned invalid data");
        return encryptedData.encrypted;
    } catch (error) {
        console.error("Encryption Error:", error);
        throw new Error("Failed to encrypt data");
    }
}

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

        const { id, fromUserId, toUserId, notes, adminId } = body;
        if (!id || !fromUserId || !toUserId || !notes || !adminId) {
            console.error("Error: Missing required fields.");
            return { statusCode: 400, body: JSON.stringify({ message: "Missing required fields: id, fromUserId, toUserId, notes, adminId" }) };
        }

        console.log("Encrypting all data...");
        const [encryptedId, encryptedFromUserId, encryptedToUserId, encryptedNotes, encryptedAdminId, encryptedPK, encryptedSK, encryptedGSI1PK, encryptedGSI1SK, encryptedGSI2PK, encryptedGSI2SK] = await Promise.all([
            encryptData(id),
            encryptData(fromUserId),
            encryptData(toUserId),
            encryptData(notes),
            encryptData(adminId),
            encryptData(`MESSAGE#${id}`),
            encryptData("DETAILS"),
            encryptData(`USER#${fromUserId}`),
            encryptData("CREATED_AT"),
            encryptData(`USER#${toUserId}`),
            encryptData("CREATED_AT"),
        ]);

        const reviewedAt = new Date().toISOString();

        const item = {
            PK: encryptedPK,
            SK: encryptedSK,
            GSI1PK: encryptedGSI1PK,
            GSI1SK: encryptedGSI1SK,
            GSI2PK: encryptedGSI2PK,
            GSI2SK: encryptedGSI2SK,
            fromUserId: encryptedFromUserId,
            toUserId: encryptedToUserId,
            notes: encryptedNotes,
            reviewedBy: encryptedAdminId,
            reviewedAt,
        };

        console.log("DynamoDB Item to Insert:", JSON.stringify(item, null, 2));

        await dynamoDB.put({ TableName: TABLE_NAME, Item: item }).promise();
        console.log("DynamoDB Inserted Successfully");

        if (QUEUE_URL) {
            console.log("Sending message to SQS...");
            await sqs.sendMessage({
                QueueUrl: QUEUE_URL,
                MessageBody: JSON.stringify({
                    id: encryptedId,
                    fromUserId: encryptedFromUserId,
                    toUserId: encryptedToUserId,
                    notes: encryptedNotes,
                    adminId: encryptedAdminId,
                    action: "review_details",
                }),
            }).promise();
            console.log("SQS Message Sent");
        }

        console.log("Sending event to EventBridge...");
        await eventBridge.putEvents({
            Entries: [
                {
                    Source: "messages.service",
                    DetailType: "DetailEvent",
                    Detail: JSON.stringify({
                        id: encryptedId,
                        fromUserId: encryptedFromUserId,
                        toUserId: encryptedToUserId,
                        notes: encryptedNotes,
                        adminId: encryptedAdminId,
                    }),
                    EventBusName: EVENT_BUS_NAME,
                },
            ],
        }).promise();
        console.log("EventBridge Triggered");

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Message details recorded", id: encryptedId }),
        };
    } catch (error) {
        console.error("Unexpected Error:", JSON.stringify(error, null, 2));
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};