const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();

const TABLE_NAME = process.env.CARDS_TABLE_NAME || "Cards";
const SQS_QUEUE_URL = process.env.CARD_QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";

exports.handler = async (event) => {
    try {
        console.log("Received event:", JSON.stringify(event, null, 2));

        if (!event.body) {
            return { statusCode: 400, body: JSON.stringify({ message: "Request body is required" }) };
        }

        let body;
        try {
            body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
        } catch (error) {
            return { statusCode: 400, body: JSON.stringify({ message: "Invalid JSON format" }) };
        }

        const { title, description, userId } = body;
        const id = event.pathParameters.id; // Get ID from URL path

        if (!id || typeof id !== "string" || id.trim() === "") {
            return { statusCode: 400, body: JSON.stringify({ message: "Missing or invalid required field: id" }) };
        }

        if (!title || !description || !userId) {
            return { statusCode: 400, body: JSON.stringify({ message: "Missing required fields: title, description, userId" }) };
        }

        console.log("Checking if item exists before updating...");

        // 🔹 Use the correct partition key format
        const primaryKey = `CARD#${id}`;
        const sortKey = "METADATA"; // Your sort key

        const getParams = {
            TableName: TABLE_NAME,
            Key: { PK: primaryKey, SK: sortKey }
        };

        const existingItem = await dynamoDB.get(getParams).promise();
        if (!existingItem.Item) {
            return { statusCode: 404, body: JSON.stringify({ message: "Item not found" }) };
        }

        console.log("Item found. Updating DynamoDB...");

        const updateParams = {
            TableName: TABLE_NAME,
            Key: { PK: primaryKey, SK: sortKey }, // Corrected key structure
            UpdateExpression: "SET title = :title, description = :description, updatedAt = :updatedAt",
            ExpressionAttributeValues: {
                ":title": title,
                ":description": description,
                ":updatedAt": new Date().toISOString()
            },
            ReturnValues: "ALL_NEW"
        };

        const result = await dynamoDB.update(updateParams).promise();
        const updatedItem = result.Attributes;

        console.log("DynamoDB Update Successful:", JSON.stringify(updatedItem, null, 2));

        // Send message to SQS
        if (SQS_QUEUE_URL) {
            const sqsParams = {
                QueueUrl: SQS_QUEUE_URL,
                MessageBody: JSON.stringify({ id, title, description, userId, eventType: "CardUpdated" })
            };
            try {
                await sqs.sendMessage(sqsParams).promise();
                console.log("SQS Message Sent Successfully");
            } catch (sqsError) {
                console.error("Failed to send SQS message:", JSON.stringify(sqsError, null, 2));
            }
        }

        // Send event to EventBridge
        const eventBridgeParams = {
            Entries: [
                {
                    Source: "cards.update",
                    DetailType: "CardUpdated",
                    Detail: JSON.stringify({ id, title, description, userId, updatedAt: updatedItem.updatedAt }),
                    EventBusName: EVENT_BUS_NAME
                }
            ]
        };
        try {
            await eventBridge.putEvents(eventBridgeParams).promise();
            console.log("EventBridge Event Sent Successfully");
        } catch (ebError) {
            console.error("Failed to send EventBridge event:", JSON.stringify(ebError, null, 2));
        }

        return { statusCode: 200, body: JSON.stringify({ message: "Card updated successfully", updatedItem }) };
    } catch (error) {
        console.error("Unexpected Error:", JSON.stringify(error, null, 2));
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

