const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();

// Environment Variables
const CARDS_TABLE = process.env.CARDS_TABLE; // DynamoDB Table
const QUEUE_URL = process.env.UNCOVER_QUEUE_URL; // SQS Queue for UncoverQueue
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME; // EventBridge Bus Name

exports.handler = async (event) => {
    try {
        console.log("Incoming Event:", JSON.stringify(event, null, 2));

        //  Extract `id` from pathParameters
        const pathParams = event.pathParameters || {};
        console.log("Extracted Path Parameters:", JSON.stringify(pathParams, null, 2));

        const cardId = pathParams.id;

        if (!cardId) {
            console.error("Validation Failed: Missing `id` in path parameters.");
            return sendResponse(400, { message: "Missing required field: id (path parameter)." });
        }
        
        //  Extract body and parse JSON safely
        let body;
        try {
            body = event.body ? JSON.parse(event.body) : {};
        } catch (parseError) {
            console.error("Error parsing request body:", parseError);
            return sendResponse(400, { message: "Invalid JSON format in request body." });
        }

        const { userId, paymentType } = body;

        // Validate inputs
        if (!userId || !paymentType) {
            console.error("Validation Failed: Missing required fields", { userId, paymentType });
            return sendResponse(400, { message: "Missing required fields: userId, paymentType." });
        }

        if (!["CHAPTER_COINS", "GOLD_COINS"].includes(paymentType)) {
            return sendResponse(400, { message: "Invalid paymentType. Allowed values: CHAPTER_COINS, GOLD_COINS." });
        }

        const timestamp = new Date().toISOString();

        //  Check if the card is already uncovered
        const getParams = {
            TableName: CARDS_TABLE,
            Key: {
                "CARD#{id}": `CARD#${cardId}`,
                "METADATA": "DETAILS",
            },
        };

        try {
            const existingItem = await dynamoDB.get(getParams).promise();
            if (existingItem.Item) {
                return sendResponse(400, { message: "Card is already uncovered." });
            }
        } catch (getError) {
            console.error("DynamoDB Get Error:", getError);
            return sendResponse(500, { message: "DynamoDB get error", error: getError.message });
        }

        // Insert the new uncovered card record
        const putParams = {
            TableName: CARDS_TABLE,
            Item: {
                "CARD#{id}": `CARD#${cardId}`,  // Matches DynamoDB schema
                "METADATA": "DETAILS",  // Correct SK name
                "userId": userId,
                "paymentType": paymentType,
                "uncoveredAt": timestamp
            },
            ConditionExpression: "attribute_not_exists(#PK) AND attribute_not_exists(#SK)", //  Ensures uniqueness
            ExpressionAttributeNames: {
                "#PK": "CARD#{id}",  //  Map PK placeholder
                "#SK": "METADATA"    //  Map SK placeholder
            }
        };

        console.log("DynamoDB Put Params:", JSON.stringify(putParams, null, 2));

        try {
            await dynamoDB.put(putParams).promise();
        } catch (dbError) {
            if (dbError.code === "ConditionalCheckFailedException") {
                console.error("Card already uncovered:", dbError);
                return sendResponse(400, { message: "Card is already uncovered." });
            }
            console.error("DynamoDB Error:", dbError);
            return sendResponse(500, { message: "DynamoDB error", error: dbError.message });
        }

        // Send to SQS (UncoverQueue)
        const sqsParams = {
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify({
                action: "CARD_UNCOVERED",
                cardId,
                userId,
                paymentType,
                uncoveredAt: timestamp,
            }),
        };

        console.log("SQS Send Params:", JSON.stringify(sqsParams, null, 2));

        try {
            await sqs.sendMessage(sqsParams).promise();
        } catch (sqsError) {
            console.error("SQS Error:", sqsError);
            return sendResponse(500, { message: "SQS error", error: sqsError.message });
        }

        //  Publish event to EventBridge (UncoverEvent)
        const eventBridgeParams = {
            Entries: [
                {
                    Source: "marketplace.card.uncover",
                    EventBusName: EVENT_BUS_NAME,
                    DetailType: "CardUncovered",
                    Detail: JSON.stringify({
                        cardId,
                        userId,
                        paymentType,
                        uncoveredAt: timestamp,
                    }),
                },
            ],
        };

        console.log("EventBridge Publish Params:", JSON.stringify(eventBridgeParams, null, 2));

        try {
            await eventBridge.putEvents(eventBridgeParams).promise();
        } catch (eventError) {
            console.error("EventBridge Error:", eventError);
            return sendResponse(500, { message: "EventBridge error", error: eventError.message });
        }

        return sendResponse(200, {
            message: "Card uncovered successfully",
            cardId,
            userId,
            paymentType,
            uncoveredAt: timestamp,
        });

    } catch (error) {
        console.error("General Lambda Error:", error);
        return sendResponse(500, { message: "Internal Server Error", error: error.message });
    }
};

// Helper function for sending responses
const sendResponse = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
});
