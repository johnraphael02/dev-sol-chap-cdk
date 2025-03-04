const AWS = require("aws-sdk");
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const { v4: uuidv4 } = require("uuid");

const CATEGORIES_TABLE = process.env.CATEGORIES_TABLE; // DynamoDB Table Name
const CATEGORY_QUEUE_URL = process.env.QUEUE_URL; // SQS Queue for Category
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME; // EventBridge Bus Name

/**
 * Lambda Handler for Creating a Category
 * @param {Object} event - API Gateway Event
 */
exports.handler = async (event) => {
    try {
        // Parse the request body
        const { marketplaceId, name, description } = JSON.parse(event.body);

        // Validate required fields
        if (!marketplaceId || !name || !description) {
            return sendResponse(400, { message: "Missing required fields: marketplaceId, name, or description." });
        }

        // Generate a unique Category ID
        const categoryId = uuidv4();
        const timestamp = new Date().toISOString();

        // Prepare DynamoDB parameters
        const params = {
            TableName: CATEGORIES_TABLE,
            Item: {
                PK: `CATEGORY#${categoryId}`,
                SK: `MARKETPLACE#${marketplaceId}`,
                GSI1PK: `MARKETPLACE#${marketplaceId}`,
                GSI1SK: `CATEGORY#${categoryId}`,
                name,
                description,
                createdAt: timestamp,
                updatedAt: timestamp,
            },
        };

        // Save to DynamoDB
        await dynamoDB.put(params).promise();

        // Send event to SQS Queue
        await sqs.sendMessage({
            QueueUrl: CATEGORY_QUEUE_URL,
            MessageBody: JSON.stringify({
                action: "CATEGORY_CREATED",
                categoryId,
                marketplaceId,
                name,
                description,
                createdAt: timestamp
            }),
        }).promise();

        // Publish event to EventBridge
        await eventBridge.putEvents({
            Entries: [{
                Source: "marketplace.category",
                EventBusName: EVENT_BUS_NAME,
                DetailType: "CategoryCreated",
                Detail: JSON.stringify({
                    categoryId,
                    marketplaceId,
                    name,
                    description,
                    createdAt: timestamp
                }),
            }]
        }).promise();

        return sendResponse(201, { message: "Category created successfully", categoryId });
    } catch (error) {
        console.error("Error creating category:", error);
        return sendResponse(500, { message: "Internal Server Error", error: error.message });
    }
};

/**
 * Helper function to send API responses
 */
const sendResponse = (statusCode, body) => {
    return {
        statusCode,
        body: JSON.stringify(body),
    };
};
