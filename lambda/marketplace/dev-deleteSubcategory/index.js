const AWS = require("aws-sdk");
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();

const SUBCATEGORIES_TABLE = process.env.SUBCATEGORIES_TABLE;
const QUEUE_URL = process.env.QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;

exports.handler = async (event) => {
    try {
        const subcategoryId = event.pathParameters?.id;
        if (!subcategoryId) {
            return sendResponse(400, { message: "Subcategory ID is required." });
        }

        console.log(`Deleting subcategory: ${subcategoryId}`);

        // Query to get the categoryId from the correct PK structure
        const queryParams = {
            TableName: SUBCATEGORIES_TABLE,
            KeyConditionExpression: "PK = :subcategoryId",
            ExpressionAttributeValues: {
                ":subcategoryId": `SUBCATEGORY#${subcategoryId}`,
            },
        };

        const queryResult = await dynamoDB.query(queryParams).promise();
        if (!queryResult.Items || queryResult.Items.length === 0) {
            return sendResponse(404, { message: "Subcategory not found." });
        }

        const categoryId = queryResult.Items[0].SK.replace("CATEGORY#", "");

        // Delete from DynamoDB using the correct PK and SK structure
        const deleteParams = {
            TableName: SUBCATEGORIES_TABLE,
            Key: {
                PK: `SUBCATEGORY#${subcategoryId}`,
                SK: `CATEGORY#${categoryId}`,
            },
        };

        await dynamoDB.delete(deleteParams).promise();
        console.log(`Deleted subcategory ${subcategoryId} under category ${categoryId}.`);

        // Send message to SQS
        const sqsParams = {
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify({
                action: "DELETE_SUBCATEGORY",
                subcategoryId,
                categoryId,
                timestamp: new Date().toISOString(),
            }),
        };

        await sqs.sendMessage(sqsParams).promise();
        console.log(`Sent SQS message for deleted subcategory ${subcategoryId}.`);

        // Publish event to EventBridge
        const eventParams = {
            Entries: [
                {
                    Source: "marketplace.subcategory",
                    EventBusName: EVENT_BUS_NAME,
                    DetailType: "SubcategoryDeleted",
                    Detail: JSON.stringify({
                        subcategoryId,
                        categoryId,
                        timestamp: new Date().toISOString(),
                    }),
                },
            ],
        };

        await eventBridge.putEvents(eventParams).promise();
        console.log(`Published EventBridge event for deleted subcategory ${subcategoryId}.`);

        return sendResponse(200, {
            message: "Subcategory deleted successfully",
            subcategoryId,
            categoryId,
        });

    } catch (error) {
        console.error("Error deleting subcategory:", error);
        return sendResponse(500, { message: "Internal Server Error", error: error.message });
    }
};

// Helper function to send API responses
const sendResponse = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
});
