const AWS = require("aws-sdk");
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();

const MARKETPLACE_TABLE = process.env.MARKETPLACE_TABLE;
const QUEUE_URL = process.env.QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME; // EventBridge Bus Name

/**
 * Lambda Handler for Deleting a Marketplace
 */
exports.handler = async (event) => {
    try {
        const marketplaceId = event.pathParameters?.id;

        // Validate input
        if (!marketplaceId) {
            return sendResponse(400, { message: "Marketplace ID is required." });
        }

        // Check if Marketplace Exists Before Deleting
        const getParams = {
            TableName: MARKETPLACE_TABLE,
            Key: {
                PK: `MARKETPLACE#${marketplaceId}`,
                SK: "METADATA",
            },
        };

        const existingMarketplace = await dynamoDB.get(getParams).promise();

        if (!existingMarketplace.Item) {
            return sendResponse(404, { message: "Marketplace not found." });
        }

        // Optionally check the Status Index (e.g., check if it's "ACTIVE")
        const statusParams = {
            TableName: MARKETPLACE_TABLE,
            IndexName: "StatusIndex",
            KeyConditionExpression: "GSI1PK = :status",
            ExpressionAttributeValues: {
                ":status": `STATUS#ACTIVE`, // Replace with the status you want to check for
            },
        };
        const statusResult = await dynamoDB.query(statusParams).promise();

        if (statusResult.Items.length === 0) {
            return sendResponse(400, { message: "Marketplace status is not ACTIVE and cannot be deleted." });
        }

        // Delete Marketplace from DynamoDB
        const deleteParams = {
            TableName: MARKETPLACE_TABLE,
            Key: {
                PK: `MARKETPLACE#${marketplaceId}`,
                SK: "METADATA",
            },
        };

        await dynamoDB.delete(deleteParams).promise();

        // Optionally, delete any associated records based on the secondary index if needed
        /*
        const deleteAssociatedParams = {
            TableName: MARKETPLACE_TABLE,
            IndexName: "StatusIndex",
            KeyConditionExpression: "GSI1PK = :status AND GSI1SK = :marketplace",
            ExpressionAttributeValues: {
                ":status": `STATUS#ACTIVE`,
                ":marketplace": `MARKETPLACE#${marketplaceId}`,
            },
        };

        await dynamoDB.query(deleteAssociatedParams).promise();
        */

        // Send Message to SQS (MarketplaceQueue)
        const sqsParams = {
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify({
                action: "DELETE",
                marketplaceId,
                timestamp: new Date().toISOString(),
            }),
        };

        await sqs.sendMessage(sqsParams).promise();

        // Publish Event to EventBridge (MarketplaceDeleteEvent)
        const eventParams = {
            Entries: [
                {
                    Source: "marketplace.service",
                    EventBusName: EVENT_BUS_NAME,
                    DetailType: "MarketplaceDeleted",
                    Detail: JSON.stringify({
                        marketplaceId,
                        timestamp: new Date().toISOString(),
                    }),
                },
            ],
        };

        await eventBridge.putEvents(eventParams).promise();

        return sendResponse(200, { message: "Marketplace deleted successfully", marketplaceId });
    } catch (error) {
        console.error("Error deleting marketplace:", error);
        return sendResponse(500, { message: "Internal Server Error", error: error.message });
    }
};

/**
 * Helper function to send a response
 */
const sendResponse = (statusCode, body) => {
    return {
        statusCode,
        body: JSON.stringify(body),
    };
};
