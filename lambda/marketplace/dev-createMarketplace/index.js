const AWS = require("aws-sdk");

// Initialize AWS services
const dynamodb = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();

// Environment Variables
const MARKETPLACE_TABLE = process.env.MARKETPLACE_TABLE;
const MARKETPLACE_QUEUE_URL = process.env.MARKETPLACE_QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;

// Function to send creation event to SQS
const sendToQueue = async (messageBody) => {
    const params = {
        QueueUrl: MARKETPLACE_QUEUE_URL,
        MessageBody: JSON.stringify(messageBody),
    };
    await sqs.sendMessage(params).promise();
};

// Function to send creation event to EventBridge
const sendToEventBridge = async (eventDetail) => {
    const params = {
        Entries: [
            {
                Source: "marketplace.system",
                DetailType: "MarketplaceCreateEvent",
                Detail: JSON.stringify(eventDetail),
                EventBusName: EVENT_BUS_NAME,
            },
        ],
    };
    await eventBridge.putEvents(params).promise();
};

exports.handler = async (event) => {
    console.log("🔍 Environment Variables:", process.env);
    console.log("🔍 Received Event:", JSON.stringify(event));

    try {
        console.log("Received create request:", JSON.stringify(event));

        const body = JSON.parse(event.body);

        // Input validation
        const { marketplaceId, name, description } = body;
        if (!marketplaceId || !name || !description) {
            console.warn("🚨 Missing required fields.");
            return {
                statusCode: 400,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "OPTIONS, POST",
                    "Access-Control-Allow-Headers": "Content-Type",
                },
                body: JSON.stringify({ message: "Missing required fields: marketplaceId, name, description" }),
            };
        }

        console.log(`Creating Marketplace: ${marketplaceId}`);

        // Define item for insertion
        const newItem = {
            PK: `MARKETPLACE#${marketplaceId}`,
            SK: "METADATA",
            name,
            description,
            createdAt: new Date().toISOString(),
        };

        // Save to DynamoDB
        await dynamodb.put({
            TableName: MARKETPLACE_TABLE,
            Item: newItem,
        }).promise();

        console.log(`Saved to DynamoDB: ${marketplaceId}`);

        // Send creation event to SQS
        await sendToQueue({ marketplaceId, action: "CREATE" });
        console.log("Sent to SQS");

        // Send creation event to EventBridge
        await sendToEventBridge({ marketplaceId, action: "CREATE" });
        console.log("Sent to EventBridge");

        return {
            statusCode: 201,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "OPTIONS, POST",
                "Access-Control-Allow-Headers": "Content-Type",
            },
            body: JSON.stringify({ message: `Marketplace ${marketplaceId} created successfully.` }),
        };
    } catch (error) {
        console.error("🚨 Error creating marketplace:", error);
        return {
            statusCode: 500,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "OPTIONS, POST",
                "Access-Control-Allow-Headers": "Content-Type",
            },
            body: JSON.stringify({ message: "Could not create marketplace", error: error.message }),
        };
    }
};

// const AWS = require("aws-sdk");

// // Initialize AWS services
// const dynamodb = new AWS.DynamoDB.DocumentClient();
// const sqs = new AWS.SQS();
// const eventBridge = new AWS.EventBridge();
// const lambda = new AWS.Lambda();
// const encryptionFunction = "aes-encryption";

// // Environment Variables
// const MARKETPLACE_TABLE = process.env.MARKETPLACE_TABLE;
// const MARKETPLACE_QUEUE_URL = process.env.MARKETPLACE_QUEUE_URL;
// const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;

// // Function to send creation event to SQS
// const sendToQueue = async (messageBody) => {
//     const params = {
//         QueueUrl: MARKETPLACE_QUEUE_URL,
//         MessageBody: JSON.stringify(messageBody),
//     };
//     await sqs.sendMessage(params).promise();
// };

// // Function to send creation event to EventBridge
// const sendToEventBridge = async (eventDetail) => {
//     const params = {
//         Entries: [
//             {
//                 Source: "marketplace.system",
//                 DetailType: "MarketplaceCreateEvent",
//                 Detail: JSON.stringify(eventDetail),
//                 EventBusName: EVENT_BUS_NAME,
//             },
//         ],
//     };
//     await eventBridge.putEvents(params).promise();
// };

// exports.handler = async (event) => {
//     console.log("🔍 Environment Variables:", process.env);
//     console.log("🔍 Received Event:", JSON.stringify(event));

//     try {
//         console.log("Received create request:", JSON.stringify(event));

//         let body;
//         try {
//             body = JSON.parse(event.body);
//         } catch (parseError) {
//             console.error("Invalid JSON format:", parseError);
//             return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON format" }) };
//         }

//         // Input validation
//         const { marketplaceId, name, description } = body;
//         if (!marketplaceId || !name || !description) {
//             console.warn("🚨 Missing required fields.");
//             return {
//                 statusCode: 400,
//                 headers: {
//                     "Access-Control-Allow-Origin": "*",
//                     "Access-Control-Allow-Methods": "OPTIONS, POST",
//                     "Access-Control-Allow-Headers": "Content-Type",
//                 },
//                 body: JSON.stringify({ message: "Missing required fields: marketplaceId, name, description" }),
//             };
//         }

//         console.log(`Creating Marketplace: ${marketplaceId}`);

//         // 🔒 Encrypt fields
//         const encryptionResponse = await lambda.invoke({
//             FunctionName: encryptionFunction,
//             Payload: JSON.stringify({
//                 data: { marketplaceId, name, description }
//             })
//         }).promise();

//         const encryptionResult = JSON.parse(encryptionResponse.Payload);
//         const encryptedData = JSON.parse(encryptionResult.body).encryptedData?.data;

//         if (!encryptedData) {
//             throw new Error("Encryption failed");
//         }

//         // Define item for insertion with encrypted data
//         const newItem = {
//             PK: `MARKETPLACE#${encryptedData.marketplaceId}`,
//             SK: "METADATA",
//             name: encryptedData.name,
//             description: encryptedData.description,
//             createdAt: new Date().toISOString(),
//         };

//         // Save to DynamoDB
//         await dynamodb.put({
//             TableName: MARKETPLACE_TABLE,
//             Item: newItem,
//         }).promise();

//         console.log(`Saved to DynamoDB: ${marketplaceId}`);

//         // Send encrypted data to SQS
//         await sendToQueue({ 
//             marketplaceId: encryptedData.marketplaceId, 
//             name: encryptedData.name, 
//             description: encryptedData.description, 
//             action: "CREATE" 
//         });
//         console.log("Sent to SQS");

//         // Send encrypted data to EventBridge
//         await sendToEventBridge({ 
//             marketplaceId: encryptedData.marketplaceId, 
//             name: encryptedData.name, 
//             description: encryptedData.description, 
//             action: "CREATE" 
//         });
//         console.log("Sent to EventBridge");

//         return {
//             statusCode: 201,
//             headers: {
//                 "Access-Control-Allow-Origin": "*",
//                 "Access-Control-Allow-Methods": "OPTIONS, POST",
//                 "Access-Control-Allow-Headers": "Content-Type",
//             },
//             body: JSON.stringify({ message: `Marketplace ${marketplaceId} created successfully.` }),
//         };
//     } catch (error) {
//         console.error("🚨 Error creating marketplace:", error);
//         return {
//             statusCode: 500,
//             headers: {
//                 "Access-Control-Allow-Origin": "*",
//                 "Access-Control-Allow-Methods": "OPTIONS, POST",
//                 "Access-Control-Allow-Headers": "Content-Type",
//             },
//             body: JSON.stringify({ message: "Could not create marketplace", error: error.message }),
//         };
//     }
// };

