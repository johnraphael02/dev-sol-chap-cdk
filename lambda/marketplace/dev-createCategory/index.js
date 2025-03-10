const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

const TABLE_NAME = process.env.TABLE_NAME;
const QUEUE_URL = process.env.QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;
const ENCRYPTION_LAMBDA = "sol-chap-encryption"; // Encryption Lambda function name

// Function to invoke encryption Lambda
async function encryptData(data) {
    const params = {
        FunctionName: ENCRYPTION_LAMBDA,
        Payload: JSON.stringify(data), // Send object directly
    };

    const response = await lambda.invoke(params).promise();
    console.log("Encryption Lambda Raw Response:", response); // Debugging

    try {
        const encryptedResponse = JSON.parse(response.Payload);
        console.log("Parsed Encryption Response:", encryptedResponse); // Debugging

        if (encryptedResponse.statusCode !== 200) {
            throw new Error(`Encryption failed: ${encryptedResponse.body}`);
        }

        const encryptedData = JSON.parse(encryptedResponse.body).encryptedData;
        console.log("Final Encrypted Data:", encryptedData); // Debugging

        return encryptedData;
    } catch (error) {
        console.error("Error parsing encryption response:", error);
        throw new Error("Encryption Lambda response is invalid");
    }
}

exports.handler = async (event) => {
    try {
        const requestBody = JSON.parse(event.body);
        const categoryId = uuidv4();
        const marketplaceId = requestBody.marketplaceId;

        if (!requestBody.name || !marketplaceId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Missing required fields: name and marketplaceId" }),
            };
        }

        const timestamp = new Date().toISOString(); // Keep timestamp unencrypted

        // Encrypt all required fields, including PK and SK
        const encryptedValues = await encryptData({
            PK: `CATEGORY#${categoryId}`,
            SK: `MARKETPLACE#${marketplaceId}`,
            GSI1PK: `MARKETPLACE#${marketplaceId}`,
            GSI1SK: `CATEGORY#${categoryId}`,
            name: requestBody.name,
            description: requestBody.description || "",
            marketplaceId,
            categoryId
        });

        const newCategory = {
            PK: encryptedValues.PK,
            SK: encryptedValues.SK,
            GSI1PK: encryptedValues.GSI1PK,
            GSI1SK: encryptedValues.GSI1SK,
            name: encryptedValues.name,
            description: encryptedValues.description,
            createdAt: timestamp, // Keep unencrypted
            updatedAt: timestamp, // Keep unencrypted
        };

        await dynamoDb.put({ TableName: TABLE_NAME, Item: newCategory }).promise();

        // Encrypt SQS message fields (except timestamp)
        const encryptedSQSMessage = {
            action: "CATEGORY_CREATED",
            categoryId: encryptedValues.categoryId,
            marketplaceId: encryptedValues.marketplaceId,
            name: encryptedValues.name,
            description: encryptedValues.description,
            createdAt: timestamp, // Keep unencrypted
        };

        await sqs.sendMessage({
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify(encryptedSQSMessage),
        }).promise();

        // Encrypt EventBridge message fields (except timestamp)
        const encryptedEventBridgeDetail = {
            categoryId: encryptedValues.categoryId,
            marketplaceId: encryptedValues.marketplaceId,
            name: encryptedValues.name,
            description: encryptedValues.description,
            createdAt: timestamp, // Keep unencrypted
        };

        await eventBridge.putEvents({
            Entries: [{
                Source: "marketplace.category",
                EventBusName: EVENT_BUS_NAME,
                DetailType: "CategoryCreated",
                Detail: JSON.stringify(encryptedEventBridgeDetail),
            }]
        }).promise();

        return {
            statusCode: 201,
            body: JSON.stringify({
                message: "Category created successfully",
                categoryId,
                marketplaceId,
            }),
        };
    } catch (error) {
        console.error("Error creating category:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Internal Server Error", error: error.message }),
        };
    }
};