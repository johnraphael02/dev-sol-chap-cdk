// const AWS = require("aws-sdk");

// // Initialize AWS Services
// const dynamoDB = new AWS.DynamoDB.DocumentClient();
// const sqs = new AWS.SQS();
// const eventBridge = new AWS.EventBridge();

// // Environment Variables
// const MARKETPLACE_TABLE = process.env.MARKETPLACE_TABLE;
// const QUEUE_URL = process.env.QUEUE_URL;
// const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;

// /**
//  * ✅ Lambda Handler for Deleting a Marketplace
//  */
// exports.handler = async (event) => {
//     try {
//         console.log("📌 Event received:", JSON.stringify(event, null, 2));

//         // ✅ Handle CORS Preflight Request
//         if (event.httpMethod === "OPTIONS") {
//             return sendResponse(200, { message: "CORS Preflight Successful" });
//         }

//         // ✅ Extract marketplace ID from request body
//         const { marketplaceId } = JSON.parse(event.body || "{}");

//         if (!marketplaceId) {
//             return sendResponse(400, { message: "Marketplace ID is required." });
//         }

//         console.log("🔎 Checking Marketplace ID:", marketplaceId);

//         // ✅ Step 1: Check if Marketplace Exists
//         const getParams = {
//             TableName: MARKETPLACE_TABLE,
//             Key: {
//                 PK: `MARKETPLACE#${marketplaceId}`,
//                 SK: "METADATA",
//             },
//         };

//         const existingMarketplace = await dynamoDB.get(getParams).promise();

//         if (!existingMarketplace.Item) {
//             return sendResponse(404, { message: "Marketplace not found." });
//         }

//         console.log("✅ Found Marketplace Entry:", existingMarketplace.Item);

//         // ✅ Step 2: Delete Marketplace from DynamoDB
//         const deleteParams = {
//             TableName: MARKETPLACE_TABLE,
//             Key: {
//                 PK: `MARKETPLACE#${marketplaceId}`,
//                 SK: "METADATA",
//             },
//         };

//         await dynamoDB.delete(deleteParams).promise();
//         console.log("✅ Marketplace deleted from DynamoDB");

//         // ✅ Step 3: Send Message to SQS
//         const sqsParams = {
//             QueueUrl: QUEUE_URL,
//             MessageBody: JSON.stringify({
//                 action: "DELETE",
//                 marketplaceId,
//                 timestamp: new Date().toISOString(),
//             }),
//         };

//         await sqs.sendMessage(sqsParams).promise();
//         console.log("✅ Delete event sent to SQS");

//         // ✅ Step 4: Publish Event to EventBridge
//         const eventParams = {
//             Entries: [
//                 {
//                     Source: "marketplace.service",
//                     EventBusName: EVENT_BUS_NAME,
//                     DetailType: "MarketplaceDeleted",
//                     Detail: JSON.stringify({
//                         marketplaceId,
//                         timestamp: new Date().toISOString(),
//                     }),
//                 },
//             ],
//         };

//         await eventBridge.putEvents(eventParams).promise();
//         console.log("✅ Delete event published to EventBridge");

//         return sendResponse(200, {
//             message: "Marketplace deleted successfully",
//             marketplaceId,
//         });

//     } catch (error) {
//         console.error("❌ Error deleting marketplace:", error);
//         return sendResponse(500, { message: "Internal Server Error", error: error.message });
//     }
// };

// /**
//  * ✅ Helper function to send a response with CORS headers
//  */
// const sendResponse = (statusCode, body) => {
//     return {
//         statusCode,
//         headers: {
//             "Access-Control-Allow-Origin": "*",
//             "Access-Control-Allow-Methods": "OPTIONS, GET, POST, PUT, DELETE",
//             "Access-Control-Allow-Headers": "Content-Type, Authorization",
//         },
//         body: JSON.stringify(body),
//     };
// };

const AWS = require("aws-sdk");

// Initialize AWS Services
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();

// Environment Variables
const MARKETPLACE_TABLE = process.env.MARKETPLACE_TABLE;
const QUEUE_URL = process.env.QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;

/**
 * ✅ Lambda Handler for Deleting a Marketplace
 */
exports.handler = async (event) => {
    console.log("📌 Event received:", JSON.stringify(event, null, 2));

    // ✅ Handle CORS Preflight Request
    if (event.httpMethod === "OPTIONS") {
        return sendCORSResponse(200, {});
    }

    try {
        // ✅ Extract marketplace ID from **path parameters**, not the request body
        const marketplaceId = event.pathParameters ? event.pathParameters.id : null;

        if (!marketplaceId) {
            return sendResponse(400, { message: "Marketplace ID is required in the URL path." });
        }

        console.log("🔎 Checking Marketplace ID:", marketplaceId);

        // ✅ Step 1: Check if Marketplace Exists
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

        console.log("✅ Found Marketplace Entry:", existingMarketplace.Item);

        // ✅ Step 2: Delete Marketplace from DynamoDB
        const deleteParams = {
            TableName: MARKETPLACE_TABLE,
            Key: {
                PK: `MARKETPLACE#${marketplaceId}`,
                SK: "METADATA",
            },
        };

        await dynamoDB.delete(deleteParams).promise();
        console.log("✅ Marketplace deleted from DynamoDB");

        // ✅ Step 3: Send Message to SQS
        const sqsParams = {
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify({
                action: "DELETE",
                marketplaceId,
                timestamp: new Date().toISOString(),
            }),
        };

        await sqs.sendMessage(sqsParams).promise();
        console.log("✅ Delete event sent to SQS");

        // ✅ Step 4: Publish Event to EventBridge
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
        console.log("✅ Delete event published to EventBridge");

        return sendResponse(200, {
            message: "Marketplace deleted successfully",
            marketplaceId,
        });

    } catch (error) {
        console.error("❌ Error deleting marketplace:", error);
        return sendResponse(500, { message: "Internal Server Error", error: error.message });
    }
};

/**
 * ✅ Helper function to send a response with CORS headers
 */
const sendResponse = (statusCode, body) => {
    return {
        statusCode,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "OPTIONS, GET, POST, PUT, DELETE",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
        body: JSON.stringify(body),
    };
};

/**
 * ✅ Helper function to send CORS response for OPTIONS requests
 */
const sendCORSResponse = (statusCode, body) => {
    return {
        statusCode,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "OPTIONS, GET, POST, PUT, DELETE",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
        body: JSON.stringify(body || {}),
    };
};
