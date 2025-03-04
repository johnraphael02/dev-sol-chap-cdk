const AWS = require("aws-sdk");
const dynamodb = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();

/**
 * Send message to MarketplaceQueue (SQS)
 */
const sendToQueue = async (messageBody) => {
    const params = {
        QueueUrl: process.env.MARKETPLACE_QUEUE_URL,
        MessageBody: JSON.stringify(messageBody),
    };
    await sqs.sendMessage(params).promise();
};

/**
 * Send event to EventBridge
 */
const sendToEventBridge = async (eventDetail) => {
    const params = {
        Entries: [
            {
                Source: "com.mycompany.marketplace",
                DetailType: "MarketplaceUpdateEvent",
                Detail: JSON.stringify(eventDetail),
                EventBusName: process.env.EVENT_BUS_NAME,
            },
        ],
    };
    await eventBridge.putEvents(params).promise();
};

exports.handler = async (event) => {
    try {
        const { id } = event.pathParameters;
        const body = JSON.parse(event.body);

        if (!id) {
            return { statusCode: 400, body: JSON.stringify({ message: "Missing required id" }) };
        }

        if (!body || Object.keys(body).length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "At least one field (name, description, status, settings) is required to update" }),
            };
        }

        // Fetch existing marketplace data
        const existingItem = await dynamodb.get({
            TableName: process.env.DYNAMODB_MARKETPLACE_TABLE,
            Key: { PK: `MARKETPLACE#${id}`, SK: "METADATA" },
        }).promise();

        if (!existingItem.Item) {
            return { statusCode: 404, body: JSON.stringify({ message: "Marketplace not found" }) };
        }

        // Encrypt sensitive data before updating
        const encryptionParams = {
            FunctionName: process.env.ENCRYPTION_LAMBDA,
            Payload: JSON.stringify({ body: JSON.stringify(body) }),
        };

        const encryptionResponse = await lambda.invoke(encryptionParams).promise();
        const encryptionResponseParsed = JSON.parse(encryptionResponse.Payload);

        if (encryptionResponseParsed.statusCode >= 400) {
            return { statusCode: 500, body: JSON.stringify({ message: "Failed to encrypt data" }) };
        }

        const encryptedData = JSON.parse(encryptionResponseParsed.body).encryptedData;

        // Prepare updated attributes
        const updatedItem = {
            ...existingItem.Item,
            ...encryptedData, // Merge new encrypted data
            updatedAt: Math.floor(Date.now() / 1000),
        };

        // Update item in DynamoDB
        await dynamodb.put({
            TableName: process.env.DYNAMODB_MARKETPLACE_TABLE,
            Item: updatedItem,
        }).promise();

        // Send update event to SQS
        await sendToQueue(updatedItem);

        // Send update event to EventBridge
        await sendToEventBridge(updatedItem);

        return { statusCode: 200, body: JSON.stringify({ message: "Marketplace updated successfully", updatedItem }) };
    } catch (error) {
        console.error("Error updating marketplace:", error);
        return { statusCode: 500, body: JSON.stringify({ message: error.message || "Internal Server Error" }) };
    }
};
