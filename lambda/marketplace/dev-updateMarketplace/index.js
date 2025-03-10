const AWS = require("aws-sdk");
const dynamodb = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();

const MARKETPLACE_TABLE = process.env.MARKETPLACE_TABLE;
const MARKETPLACE_QUEUE_URL = process.env.MARKETPLACE_QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;
const encryptionFunction = "sol-chap-encryption";

/**
 * Encrypts text using the encryption Lambda function.
 */
async function encryptText(text) {
    console.log(`🔑 Encrypting text: ${text}`);

    const params = {
        FunctionName: encryptionFunction,
        InvocationType: "RequestResponse",
        Payload: JSON.stringify({ body: JSON.stringify({ text }) }),
    };

    try {
        const response = await lambda.invoke(params).promise();
        console.log("🔒 Raw Encryption Lambda Response:", response);

        if (!response.Payload) {
            throw new Error("Encryption Lambda did not return a valid response.");
        }

        const encryptionResult = JSON.parse(response.Payload);
        const encryptedData = JSON.parse(encryptionResult.body).encryptedData?.text;

        if (!encryptedData) {
            throw new Error("Failed to retrieve encrypted data.");
        }

        return encryptedData;
    } catch (error) {
        console.error("❌ Encryption error:", error);
        throw error;
    }
}

/**
 * Send message to MarketplaceQueue (SQS)
 */
const sendToQueue = async (messageBody) => {
    const params = {
        QueueUrl: queueUrl,
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
                EventBusName: eventBusName,
            },
        ],
    };
    await eventBridge.putEvents(params).promise();
};

exports.handler = async (event) => {
    console.log("Received event:", JSON.stringify(event, null, 2));

    try {
        const marketplaceId = event.pathParameters?.id;
        const requestBody = JSON.parse(event.body);

        if (!marketplaceId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Missing required id" }),
            };
        }

        if (!requestBody || Object.keys(requestBody).length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: "At least one field (name, description, status, settings) is required to update",
                }),
            };
        }

        console.log(`🔑 Encrypting input marketplaceId: MARKETPLACE#${marketplaceId}`);
        const encryptedMarketplaceId = await encryptText(`MARKETPLACE#${marketplaceId}`);
        const encryptedMetadataSK = await encryptText("METADATA");

        console.log(`🔎 Searching for marketplace with encrypted PK: ${encryptedMarketplaceId} and SK: ${encryptedMetadataSK}`);

        // Fetch existing marketplace data
        const existingItem = await dynamodb.get({
            TableName: MARKETPLACE_TABLE,
            Key: { PK: encryptedMarketplaceId, SK: encryptedMetadataSK },
        }).promise();

        if (!existingItem.Item) {
            return { statusCode: 404, body: JSON.stringify({ message: "Marketplace not found" }) };
        }

        console.log("✅ Marketplace found, proceeding with update.");

        // 🔐 Encrypt updated fields
        const [encryptedName, encryptedDescription, encryptedStatus, encryptedSettings] = await Promise.all([
            requestBody.name ? encryptText(requestBody.name) : existingItem.Item.name,
            requestBody.description ? encryptText(requestBody.description) : existingItem.Item.description,
            requestBody.status ? encryptText(requestBody.status) : existingItem.Item.status,
            requestBody.settings ? encryptText(JSON.stringify(requestBody.settings)) : existingItem.Item.settings,
        ]);

        const timestamp = new Date().toISOString();

        // Step 2: Encrypt PK and SK before storing
        const encryptedPK = await encryptText(`MARKETPLACE#${marketplaceId}`);
        const encryptedSK = await encryptText("METADATA");

        // Step 3: Prepare updated attributes
        const updatedItem = {
            PK: encryptedPK, // Matched encrypted marketplaceId
            SK: encryptedSK, // Encrypted SK
            name: encryptedName,
            description: encryptedDescription,
            status: encryptedStatus,
            settings: encryptedSettings,
            updatedAt: timestamp,
        };

        // Step 4: Update the marketplace in DynamoDB
        await dynamodb.put({
            TableName: MARKETPLACE_TABLE,
            Item: updatedItem,
        }).promise();

        console.log("✅ Marketplace updated successfully:", updatedItem);

        // Step 5: Send encrypted update to SQS
        await sendToQueue(updatedItem);

        // Step 6: Publish encrypted update to EventBridge
        await sendToEventBridge(updatedItem);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Marketplace updated successfully",
                item: updatedItem,
            }),
        };
    } catch (error) {
        console.error("❌ Error updating marketplace:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Failed to update marketplace", error: error.message }),
        };
    }
};
