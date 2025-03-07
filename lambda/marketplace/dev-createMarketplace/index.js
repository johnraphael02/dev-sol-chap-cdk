// const AWS = require("aws-sdk");
// const crypto = require("crypto");

// // Initialize AWS services
// const dynamodb = new AWS.DynamoDB.DocumentClient();
// const sqs = new AWS.SQS();
// const eventBridge = new AWS.EventBridge();

// // Environment Variables
// const MARKETPLACE_TABLE = process.env.MARKETPLACE_TABLE;
// const MARKETPLACE_QUEUE_URL = process.env.MARKETPLACE_QUEUE_URL;
// const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;
// const SECRET_KEY = process.env.AES_SECRET_KEY;
// const SECRET_IV = process.env.AES_SECRET_IV;
// const ENCRYPTION_METHOD = process.env.AES_ENCRYPTION_METHOD;

// // Ensure encryption keys are set
// if (!SECRET_KEY || !SECRET_IV || !ENCRYPTION_METHOD) {
//     console.error("❌ Missing AES encryption environment variables.");
//     throw new Error("AES_SECRET_KEY, AES_SECRET_IV, and AES_ENCRYPTION_METHOD are required.");
// }

// // Generate encryption key and IV
// const key = crypto.createHash("sha512").update(SECRET_KEY).digest("hex").substring(0, 32);
// const encryptionIV = crypto.createHash("sha512").update(SECRET_IV).digest("hex").substring(0, 16);

// // Encrypt data using AES
// function encryptData(data) {
//     const cipher = crypto.createCipheriv(ENCRYPTION_METHOD, key, encryptionIV);
//     return Buffer.from(cipher.update(data, "utf8", "hex") + cipher.final("hex")).toString("base64");
// }

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
//     console.log("🔍 Raw event.body:", event.body);

//     let body;
//     try {
//         body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
//     } catch (parseError) {
//         console.error("🚨 Failed to parse JSON body:", parseError);
//         return {
//             statusCode: 400,
//             headers: {
//                 "Access-Control-Allow-Origin": "*",
//                 "Access-Control-Allow-Methods": "OPTIONS, POST",
//                 "Access-Control-Allow-Headers": "Content-Type",
//             },
//             body: JSON.stringify({ message: "Invalid JSON body" }),
//         };
//     }

//     try {
//         console.log("Received create request:", JSON.stringify(body));

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

//         console.log(`🔒 Encrypting Marketplace Data for ID: ${marketplaceId}`);

//         // Encrypt name and description before storing
//         const encryptedName = encryptData(name);
//         const encryptedDescription = encryptData(description);

//         // Define item for insertion
//         const newItem = {
//             PK: `MARKETPLACE#${marketplaceId}`,
//             SK: "METADATA",
//             name: encryptedName,
//             description: encryptedDescription,
//             createdAt: new Date().toISOString(),
//         };

//         // Save to DynamoDB
//         await dynamodb.put({
//             TableName: MARKETPLACE_TABLE,
//             Item: newItem,
//         }).promise();

//         console.log(`✅ Saved encrypted data to DynamoDB: ${marketplaceId}`);

//         // Send creation event to SQS
//         await sendToQueue({ marketplaceId, action: "CREATE" });
//         console.log("✅ Sent encrypted data to SQS");

//         // Send creation event to EventBridge
//         await sendToEventBridge({ marketplaceId, action: "CREATE" });
//         console.log("✅ Sent encrypted data to EventBridge");

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

const AWS = require("aws-sdk");

// Initialize AWS services
const dynamodb = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda(); // ✅ Add Lambda to invoke encryption function

// Environment Variables
const MARKETPLACE_TABLE = process.env.MARKETPLACE_TABLE;
const MARKETPLACE_QUEUE_URL = process.env.MARKETPLACE_QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;
const ENCRYPTION_LAMBDA_NAME = "sol-chap-encryption"; // ✅ Replace local encryption with Lambda

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

// Function to encrypt data using the sol-chap-encryption Lambda
const encryptData = async (data) => {
    try {
        const encryptionParams = {
            FunctionName: ENCRYPTION_LAMBDA_NAME,
            Payload: JSON.stringify({
                body: JSON.stringify(data), // ✅ Sending data as body
            }),
        };

        const encryptionResponse = await lambda.invoke(encryptionParams).promise();
        const encryptionParsed = JSON.parse(encryptionResponse.Payload);
        
        if (encryptionParsed.statusCode >= 400) {
            console.error("❌ Encryption Lambda failed:", encryptionParsed.body);
            throw new Error("Encryption failed");
        }

        return JSON.parse(encryptionParsed.body).encryptedData; // ✅ Extract encrypted data
    } catch (error) {
        console.error("🚨 Error invoking encryption Lambda:", error);
        throw new Error("Could not encrypt data");
    }
};

exports.handler = async (event) => {
    console.log("🔍 Environment Variables:", process.env);
    console.log("🔍 Raw event.body:", event.body);

    let body;
    try {
        body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    } catch (parseError) {
        console.error("🚨 Failed to parse JSON body:", parseError);
        return {
            statusCode: 400,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "OPTIONS, POST",
                "Access-Control-Allow-Headers": "Content-Type",
            },
            body: JSON.stringify({ message: "Invalid JSON body" }),
        };
    }

    try {
        console.log("Received create request:", JSON.stringify(body));

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

        console.log(`🔒 Encrypting Marketplace Data for ID: ${marketplaceId}`);

        // 🔹 Invoke encryption Lambda
        const encryptedData = await encryptData({ name, description });

        // Define item for insertion
        const newItem = {
            PK: `MARKETPLACE#${marketplaceId}`,
            SK: "METADATA",
            name: encryptedData.name,
            description: encryptedData.description,
            createdAt: new Date().toISOString(),
        };

        // Save to DynamoDB
        await dynamodb.put({
            TableName: MARKETPLACE_TABLE,
            Item: newItem,
        }).promise();

        console.log(`✅ Saved encrypted data to DynamoDB: ${marketplaceId}`);

        // Send creation event to SQS
        await sendToQueue({ marketplaceId, action: "CREATE" });
        console.log("✅ Sent encrypted data to SQS");

        // Send creation event to EventBridge
        await sendToEventBridge({ marketplaceId, action: "CREATE" });
        console.log("✅ Sent encrypted data to EventBridge");

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
