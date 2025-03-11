const AWS = require("aws-sdk");

// Initialize AWS services
const dynamodb = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();
const encryptionFunction = "sol-chap-encryption";

// Environment Variables
const MARKETPLACE_TABLE = process.env.MARKETPLACE_TABLE;
const MARKETPLACE_QUEUE_URL = process.env.MARKETPLACE_QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;

// Function to invoke encryption Lambda
async function encryptData(data) {
    const params = {
        FunctionName: encryptionFunction,
        Payload: JSON.stringify({ data }),
    };

    const response = await lambda.invoke(params).promise();
    console.log("Encryption Lambda Raw Response:", response);

    try {
        const encryptedResponse = JSON.parse(response.Payload);
        console.log("Parsed Encryption Response:", encryptedResponse);

        if (encryptedResponse.statusCode !== 200) {
            throw new Error(`Encryption failed: ${encryptedResponse.body}`);
        }

        const encryptedData = JSON.parse(encryptedResponse.body).encryptedData.data;
        console.log("Final Encrypted Data:", encryptedData);

        return encryptedData;
    } catch (error) {
        console.error("Error parsing encryption response:", error);
        throw new Error("Encryption Lambda response is invalid");
    }
}

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
        let body;
        try {
            body = JSON.parse(event.body);
        } catch (parseError) {
            console.error("Invalid JSON format:", parseError);
            return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON format" }) };
        }

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

        // 🔒 Encrypt fields including PK and SK
        const encryptedValues = await encryptData({
            PK: `MARKETPLACE#${marketplaceId}`,
            SK: "METADATA",
            name,
            description,
        });

        // Define item for insertion with encrypted data
        const timestamp = new Date().toISOString();
        const newItem = {
            PK: encryptedValues.PK,
            SK: encryptedValues.SK,
            name: encryptedValues.name,
            description: encryptedValues.description,
            createdAt: timestamp,
        };

        // Save to DynamoDB
        await dynamodb.put({
            TableName: MARKETPLACE_TABLE,
            Item: newItem,
        }).promise();

        console.log(`Saved to DynamoDB: ${marketplaceId}`);

        // Send encrypted data to SQS
        await sendToQueue({
            marketplaceId: encryptedValues.PK, 
            name: encryptedValues.name, 
            description: encryptedValues.description, 
            action: "CREATE",
            createdAt: timestamp,
        });
        console.log("Sent to SQS");

        // Send encrypted data to EventBridge
        await sendToEventBridge({
            marketplaceId: encryptedValues.PK, 
            name: encryptedValues.name, 
            description: encryptedValues.description, 
            action: "CREATE",
            createdAt: timestamp,
        });
        console.log("Sent to EventBridge");

        return {
            statusCode: 201,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "OPTIONS, POST",
                "Access-Control-Allow-Headers": "Content-Type",
            },
            body: JSON.stringify({ message: `Marketplace created successfully.` }),
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