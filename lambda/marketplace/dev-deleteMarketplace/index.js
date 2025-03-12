const AWS = require("aws-sdk");

// AWS Service Clients
const dynamodb = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

// Environment Variables
const MARKETPLACE_TABLE = process.env.MARKETPLACE_TABLE;
const QUEUE_URL = process.env.QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;
const ENCRYPT_LAMBDA_NAME = "sol-chap-encryption"; // Encryption Lambda function

/**
 * Invokes the Encryption Lambda function to encrypt the marketplaceId with prefix.
 */
async function encryptMarketplaceId(marketplaceId) {
    console.log(`🔑 Encrypting Marketplace ID: ${marketplaceId}`);

    const prefixedId = `MARKETPLACE#${marketplaceId}`;
    const params = {
        FunctionName: ENCRYPT_LAMBDA_NAME,
        InvocationType: "RequestResponse",
        Payload: JSON.stringify({ PK: prefixedId }),
    };

    try {
        const response = await lambda.invoke(params).promise();
        console.log("🔒 Raw Encryption Lambda Response:", response);

        const payload = JSON.parse(response.Payload);
        console.log("🔒 Parsed Encryption Response:", payload);

        if (!payload || !payload.body) {
            throw new Error("Invalid encryption response");
        }

        const encryptedData = JSON.parse(payload.body);
        if (!encryptedData.encryptedData || !encryptedData.encryptedData.PK) {
            throw new Error("Encryption failed, missing PK field");
        }

        return encryptedData.encryptedData.PK;
    } catch (error) {
        console.error("❌ Error in encryption function:", error);
        throw new Error("Encryption Lambda response is invalid");
    }
}

/**
 * Deletes a marketplace entry from DynamoDB after encrypting its ID.
 */
exports.handler = async (event) => {
    console.log("🔍 Received Event:", JSON.stringify(event));

    try {
        const marketplaceId = event.pathParameters?.id;
        if (!marketplaceId) {
            return { statusCode: 400, body: JSON.stringify({ message: "Missing marketplaceId" }) };
        }

        console.log(`🔑 Marketplace ID from URL: ${marketplaceId}`);

        // 🔐 Encrypt the marketplace ID with prefix before querying
        const encryptedPK = await encryptMarketplaceId(marketplaceId);

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
        console.log(`✅ Successfully deleted marketplace entry: ${marketplaceId}`);

        // 📢 Publish an event to EventBridge
        const eventParams = {
            Entries: [
                {
                    Source: "marketplace.system",
                    DetailType: "MarketplaceDeleted",
                    Detail: JSON.stringify({ marketplaceId }),
                    EventBusName: EVENT_BUS_NAME,
                },
            ],
        };

        // 📩 Send a message to the SQS queue
        const sqsParams = {
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify({ marketplaceId, action: "DELETE" }),
        };

        await Promise.all([
            eventBridge.putEvents(eventParams).promise(),
            sqs.sendMessage(sqsParams).promise(),
        ]);

        console.log(`📢 EventBridge event published & 📩 SQS message sent for deleted marketplace entry: ${marketplaceId}`);

        return { statusCode: 200, body: JSON.stringify({ message: "Marketplace entry deleted successfully" }) };
    } catch (error) {
        console.error("❌ Error deleting marketplace entry:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};