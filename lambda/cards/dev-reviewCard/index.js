const AWS = require("aws-sdk");
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const { v4: uuid4 } = require("uuid");

const CARDS_TABLE = process.env.CARDS_TABLE;
const QUEUE_URL = process.env.QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;

exports.handler = async (event) => {
    try {
        console.log("Incoming Event:", JSON.stringify(event, null, 2));

        const body = JSON.parse(event.body || "{}");
        const { cardId, userId, title, description, METADATA } = body;

        if (!cardId || !userId || !title || !description) {
            console.error("Validation Failed: Missing required fields");
            return sendResponse(400, { message: "Missing required fields: cardId, userId, title, description." });
        }

        //  Set default METADATA to "PENDING" if not provided
        const reviewStatus = METADATA ? METADATA.toUpperCase() : "PENDING";

        //  Validate the METADATA status
        const validStatuses = ["PENDING", "APPROVED", "REJECTED", "DETAILS"];
        if (!validStatuses.includes(reviewStatus)) {
            return sendResponse(400, { message: "Invalid METADATA value. Allowed values: PENDING, APPROVED, REJECTED,DETAILS." });
        }

        const timestamp = new Date().toISOString();

        // Store review in DynamoDB following the required schema
        const params = {
            TableName: CARDS_TABLE,
            Item: {
                "CARD#{id}": `CARD#${cardId}`,
                "METADATA": reviewStatus,  
                "userId": userId,
                "title": title,
                "description": description,
                "createdAt": timestamp,
                "updatedAt": timestamp
            },
        };

        console.log("DynamoDB Put Params:", JSON.stringify(params, null, 2));
        await dynamoDB.put(params).promise();

        // Send review event to SQS (ReviewQueue)
        const sqsParams = {
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify({
                action: "CARD_REVIEWED",
                cardId,
                userId,
                title,
                description,
                METADATA: reviewStatus, 
                createdAt: timestamp,
            }),
        };

        console.log("SQS Send Params:", JSON.stringify(sqsParams, null, 2));
        await sqs.sendMessage(sqsParams).promise();

        // Publish event to EventBridge (ReviewEvent)
        const eventBridgeParams = {
            Entries: [
                {
                    Source: "marketplace.card.review",
                    EventBusName: EVENT_BUS_NAME,
                    DetailType: "CardReviewStatusUpdated",
                    Detail: JSON.stringify({
                        cardId,
                        userId,
                        title,
                        description,
                        METADATA: reviewStatus,
                        updatedAt: timestamp,
                    }),
                },
            ],
        };

        console.log("EventBridge Publish Params:", JSON.stringify(eventBridgeParams, null, 2));
        await eventBridge.putEvents(eventBridgeParams).promise();

        return sendResponse(201, {
            message: "Card review submitted successfully",
            cardId,
            METADATA: reviewStatus,
        });

    } catch (error) {
        console.error("Error submitting card review:", error);
        return sendResponse(500, { message: "Internal Server Error", error: error.message });
    }
};

// Helper function
const sendResponse = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
});
