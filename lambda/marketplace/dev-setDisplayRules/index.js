const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

const TABLE_NAME = process.env.TABLE_NAME;
const QUEUE_URL = process.env.QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;
const ENCRYPTION_LAMBDA = "sol-chap-encryption"; // Lambda for encryption

exports.handler = async (event) => {
    console.log("Received event:", JSON.stringify(event, null, 2));

    try {
        if (!event.body) {
            return { statusCode: 400, body: JSON.stringify({ message: "Request body is required" }) };
        }

        let body;
        try {
            body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
        } catch (error) {
            console.error("Invalid JSON format:", error);
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Invalid JSON format" }),
            };
        }

        // Validate required fields
        if (!body.sectionId || !body.displayRules) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Missing sectionId or displayRules" }),
            };
        }

        const { sectionId, displayRules } = body;
        const timestamp = new Date().toISOString(); // Generate timestamps
        const createdAt = body.createdAt || timestamp; // Keep existing `createdAt` if present
        const updatedAt = timestamp;

        if (!TABLE_NAME || !QUEUE_URL || !EVENT_BUS_NAME) {
            throw new Error("Missing required environment variables.");
        }

        // Encrypt `sectionId`, `PK`, `SK`, and `displayRules`
        const [encryptedSectionId, encryptedPK, encryptedSK, encryptedDisplayRules] = await Promise.all([
            encryptText(sectionId),
            encryptText(`SECTION#${sectionId}`),
            encryptText("DISPLAY"),
            encryptText(JSON.stringify(displayRules))
        ]);

        if (!encryptedSectionId || !encryptedPK || !encryptedSK || !encryptedDisplayRules) {
            throw new Error("Encryption failed for one or more required fields.");
        }

        // Update the display rules in DynamoDB
        const params = {
            TableName: TABLE_NAME,
            Key: { PK: encryptedPK, SK: encryptedSK },
            UpdateExpression: "SET displayRules = :rules, createdAt = if_not_exists(createdAt, :createdAt), updatedAt = :updatedAt",
            ExpressionAttributeValues: {
                ":rules": encryptedDisplayRules,
                ":createdAt": createdAt, // Not encrypted
                ":updatedAt": updatedAt  // Not encrypted
            },
        };

        // Prepare SQS message
        const sqsMessage = {
            MessageBody: JSON.stringify({
                sectionId: encryptedSectionId,
                PK: encryptedPK,
                SK: encryptedSK,
                displayRules: encryptedDisplayRules,
                createdAt,
                updatedAt
            }),
            QueueUrl: QUEUE_URL,
        };

        // Save to DynamoDB, send SQS message, and trigger EventBridge in parallel
        await Promise.all([
            dynamoDB.update(params).promise(),
            sqs.sendMessage(sqsMessage).promise(),
            eventBridge.putEvents({
                Entries: [
                    {
                        Source: "display.rules.update",
                        DetailType: "DisplayRulesUpdated",
                        Detail: JSON.stringify({
                            sectionId: encryptedSectionId,
                            PK: encryptedPK,
                            SK: encryptedSK,
                            displayRules: encryptedDisplayRules,
                            createdAt,
                            updatedAt
                        }),
                        EventBusName: EVENT_BUS_NAME
                    }
                ]
            }).promise()
        ]);

        console.log("Operations completed successfully");

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Display rules updated successfully" }),
        };

    } catch (error) {
        console.error("Error updating display rules:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error updating display rules", error: error.message }),
        };
    }
};

// Helper function for encryption using Lambda invoke
async function encryptText(text) {
    try {
        const encryptionPayload = {
            FunctionName: ENCRYPTION_LAMBDA,
            InvocationType: "RequestResponse",
            Payload: JSON.stringify({ body: JSON.stringify({ text }) }),
        };

        const encryptionResponse = await lambda.invoke(encryptionPayload).promise();
        if (!encryptionResponse.Payload) {
            throw new Error("Encryption Lambda did not return any payload.");
        }

        const encryptedData = JSON.parse(encryptionResponse.Payload);
        if (encryptedData.statusCode >= 400) {
            throw new Error("Encryption Lambda returned an error status.");
        }

        const parsedBody = JSON.parse(encryptedData.body);
        if (!parsedBody.encryptedData) {
            throw new Error("Encryption Lambda response is missing 'encryptedData'.");
        }

        return parsedBody.encryptedData.text;
    } catch (error) {
        console.error("Encryption error:", error);
        throw error;
    }
}
