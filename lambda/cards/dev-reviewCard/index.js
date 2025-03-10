const AWS = require("aws-sdk");
const lambda = new AWS.Lambda(); // For invoking the encryption function
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();

const CARDS_TABLE = process.env.CARDS_TABLE;
const QUEUE_URL = process.env.QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;
const ENCRYPTION_FUNCTION_NAME = "sol-chap-encryption"; // Name of the encryption Lambda

exports.handler = async (event) => {
    try {
        console.log("Incoming Event:", JSON.stringify(event, null, 2));

        const body = JSON.parse(event.body || "{}");
        const { cardId, userId, title, description, METADATA } = body;

        if (!cardId || !userId || !title || !description) {
            console.error("Validation Failed: Missing required fields");
            return sendResponse(400, { message: "Missing required fields: cardId, userId, title, description." });
        }

        // Set default METADATA to "PENDING" if not provided
        const reviewStatus = METADATA ? METADATA.toUpperCase() : "PENDING";

        // Validate the METADATA status
        const validStatuses = ["PENDING", "APPROVED", "REJECTED", "DETAILS"];
        if (!validStatuses.includes(reviewStatus)) {
            return sendResponse(400, { message: "Invalid METADATA value. Allowed values: PENDING, APPROVED, REJECTED, DETAILS." });
        }

        // Invoke the encryption function to encrypt data before storing and sending
        const lambdaParams = {
            FunctionName: ENCRYPTION_FUNCTION_NAME,
            InvocationType: "RequestResponse",
            Payload: JSON.stringify({
                cardId,
                userId,
                title,
                description,
                METADATA: reviewStatus,
            }),
        };

        const encryptionResponse = await lambda.invoke(lambdaParams).promise();
        const encryptionPayload = JSON.parse(encryptionResponse.Payload);

        if (encryptionResponse.FunctionError) {
            console.error("Encryption function error:", encryptionPayload);
            return sendResponse(500, { message: "Encryption function failed", error: encryptionPayload });
        }

        // The encryption function returns a JSON with "encryptedData"
        const encryptedResult = JSON.parse(encryptionPayload.body);
        const encryptedData = encryptedResult.encryptedData;

        const timestamp = new Date().toISOString();

        // Store the review data in DynamoDB (using the encrypted values, including cardId)
        const params = {
            TableName: CARDS_TABLE,
            Item: {
                "PK": `CARD#${encryptedData.cardId}`,
                "SK": encryptedData.METADATA,
                "userId": encryptedData.userId,
                "title": encryptedData.title,
                "description": encryptedData.description,
                "createdAt": timestamp,
                "updatedAt": timestamp,
                "GSI1PK": `USER#${encryptedData.userId}`,
                "GSI1SK": `CARD#${encryptedData.cardId}`,
                "GSI2PK": `STATUS#${encryptedData.METADATA}`,
                "GSI2SK": `CARD#${encryptedData.cardId}`
            },
        };

        console.log("DynamoDB Put Params:", JSON.stringify(params, null, 2));
        await dynamoDB.put(params).promise();

        // Send the review event to SQS with the encrypted payload
        const sqsParams = {
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify({
                action: "CARD_REVIEWED",
                ...encryptedData,
                createdAt: timestamp,
            }),
        };

        console.log("SQS Send Params:", JSON.stringify(sqsParams, null, 2));
        await sqs.sendMessage(sqsParams).promise();

        // Publish the event to EventBridge with the encrypted payload
        const eventBridgeParams = {
            Entries: [
                {
                    Source: "marketplace.card.review",
                    EventBusName: EVENT_BUS_NAME,
                    DetailType: "CardReviewStatusUpdated",
                    Detail: JSON.stringify({
                        ...encryptedData,
                        updatedAt: timestamp,
                    }),
                },
            ],
        };

        console.log("EventBridge Publish Params:", JSON.stringify(eventBridgeParams, null, 2));
        await eventBridge.putEvents(eventBridgeParams).promise();

        return sendResponse(201, {
            message: "Card review submitted successfully",
            cardId: encryptedData.cardId,
            METADATA: encryptedData.METADATA,
        });
    } catch (error) {
        console.error("Error submitting card review:", error);
        return sendResponse(500, { message: "Internal Server Error", error: error.message });
    }
};

// Helper function for sending responses
const sendResponse = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
});