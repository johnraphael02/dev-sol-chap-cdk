const AWS = require("aws-sdk");

// AWS Service Clients
const dynamodb = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();

// Environment Variables
const MARKETPLACE_TABLE = process.env.MARKETPLACE_TABLE;
const MARKETPLACE_QUEUE_URL = process.env.MARKETPLACE_QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;

/**
 * Deletes a marketplace entry from DynamoDB
 */
exports.handler = async (event) => {
    console.log("🔍 Received Event:", JSON.stringify(event));

    try {
        const encryptedMarketplaceId = event.pathParameters?.id; // Encrypted ID from URL
        if (!encryptedMarketplaceId) {
            return { statusCode: 400, body: JSON.stringify({ message: "Missing encrypted marketplaceId" }) };
        }

        console.log(`🔑 Encrypted marketplaceId from URL: ${encryptedMarketplaceId}`);

        // 🔍 Construct PK for query
        const encryptedPK = `MARKETPLACE#${encryptedMarketplaceId}`;

        // 🔍 Retrieve the marketplace entry
        const queryParams = {
            TableName: MARKETPLACE_TABLE,
            KeyConditionExpression: "PK = :pk",
            ExpressionAttributeValues: { ":pk": encryptedPK },
        };

        console.log("📡 Querying DynamoDB:", JSON.stringify(queryParams, null, 2));
        const queryResult = await dynamodb.query(queryParams).promise();

        if (!queryResult.Items || queryResult.Items.length === 0) {
            console.error("❌ Marketplace entry not found.");
            return { statusCode: 404, body: JSON.stringify({ message: "Marketplace entry not found" }) };
        }

        // Extract SK from the retrieved item
        const marketplaceItem = queryResult.Items[0];
        const encryptedSK = marketplaceItem.SK;

        if (!encryptedSK) {
            return { statusCode: 500, body: JSON.stringify({ message: "Marketplace SK is missing" }) };
        }

        console.log(`🔎 Found Encrypted SK: ${encryptedSK}`);

        // 🔥 Perform delete operation
        const deleteParams = {
            TableName: MARKETPLACE_TABLE,
            Key: { PK: encryptedPK, SK: encryptedSK },
        };

        console.log("🗑️ Deleting marketplace entry from DynamoDB...");
        await dynamodb.delete(deleteParams).promise();
        console.log(`✅ Successfully deleted marketplace entry: ${encryptedMarketplaceId}`);

        // 📢 Send delete event to EventBridge
        const eventParams = {
            Entries: [
                {
                    Source: "marketplace.system",
                    DetailType: "MarketplaceDeleted",
                    Detail: JSON.stringify({ marketplaceId: encryptedMarketplaceId }),
                    EventBusName: EVENT_BUS_NAME,
                },
            ],
        };
        await eventBridge.putEvents(eventParams).promise();
        console.log(`📢 EventBridge event published: MarketplaceDeleted ${encryptedMarketplaceId}`);

        // 📩 Send delete event to SQS
        const sqsParams = {
            QueueUrl: MARKETPLACE_QUEUE_URL,
            MessageBody: JSON.stringify({ marketplaceId: encryptedMarketplaceId, action: "DELETE" }),
        };
        await sqs.sendMessage(sqsParams).promise();
        console.log(`📩 SQS message sent for deleted marketplace entry: ${encryptedMarketplaceId}`);

        return { statusCode: 200, body: JSON.stringify({ message: "Marketplace entry deleted successfully" }) };
    } catch (error) {
        console.error("❌ Error deleting marketplace entry:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
