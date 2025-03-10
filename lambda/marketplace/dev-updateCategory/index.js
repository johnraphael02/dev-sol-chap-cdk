const AWS = require("aws-sdk");
const dynamodb = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

const tableName = process.env.TABLE_NAME;
const queueUrl = process.env.CATEGORY_QUEUE_URL;
const eventBusName = process.env.EVENT_BUS_NAME;
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

exports.handler = async (event) => {
    console.log("Received event:", JSON.stringify(event, null, 2));

    try {
        const categoryId = event.pathParameters?.id;
        const requestBody = JSON.parse(event.body);

        if (!categoryId || !requestBody.marketplaceId || !requestBody.name || !requestBody.description) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Missing required fields: categoryId, marketplaceId, name, description" }),
            };
        }

        console.log(`🔑 Encrypting input categoryId: CATEGORY#${categoryId}`);
        const encryptedCategoryId = await encryptText(`CATEGORY#${categoryId}`);
        const encryptedMarketplaceId = await encryptText(`MARKETPLACE#${requestBody.marketplaceId}`);

        console.log(`🔎 Searching for category with encrypted ID: ${encryptedCategoryId}`);

        // Step 1: Retrieve category from DynamoDB to ensure it exists
        const getParams = {
            TableName: tableName,
            KeyConditionExpression: "PK = :pk",
            ExpressionAttributeValues: {
                ":pk": encryptedCategoryId,
            },
        };

        const result = await dynamodb.query(getParams).promise();

        if (!result.Items || result.Items.length === 0) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: "Category not found" }),
            };
        }

        const categoryItem = result.Items[0];

        if (categoryItem.SK !== encryptedMarketplaceId) {
            return {
                statusCode: 403,
                body: JSON.stringify({ message: "Unauthorized: Marketplace ID does not match" }),
            };
        }

        console.log("✅ Category ID matches, proceeding with update.");

        // Step 2: Encrypt the updated fields
        const [encryptedName, encryptedDescription] = await Promise.all([
            encryptText(requestBody.name),
            encryptText(requestBody.description),
        ]);

        const timestamp = new Date().toISOString();

        // Step 3: Encrypt PK and SK before storing
        const encryptedPK = await encryptText(`CATEGORY#${categoryId}`);
        const encryptedSK = await encryptText(`MARKETPLACE#${requestBody.marketplaceId}`);

        // Step 4: Update the category in DynamoDB
        const updateParams = {
            TableName: tableName,
            Key: {
                PK: encryptedPK, // Matched encrypted categoryId
                SK: encryptedSK, // Matched encrypted marketplaceId
            },
            UpdateExpression: "SET #name = :name, #description = :description, updatedAt = :updatedAt",
            ExpressionAttributeNames: {
                "#name": "name",
                "#description": "description",
            },
            ExpressionAttributeValues: {
                ":name": encryptedName,
                ":description": encryptedDescription,
                ":updatedAt": timestamp,
            },
            ReturnValues: "ALL_NEW",
        };

        const updateResult = await dynamodb.update(updateParams).promise();
        const updatedCategory = updateResult.Attributes;

        console.log("✅ Category updated successfully:", updatedCategory);

        // Step 5: Send encrypted update to SQS
        const sqsMessage = {
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify({
                eventType: "CATEGORY_UPDATED",
                categoryId: encryptedCategoryId,
                marketplaceId: encryptedMarketplaceId,
                updatedCategory,
            }),
        };
        await sqs.sendMessage(sqsMessage).promise();

        // Step 6: Publish encrypted update to EventBridge
        const eventBridgeParams = {
            Entries: [
                {
                    EventBusName: eventBusName,
                    Source: "custom.category.service",
                    DetailType: "CategoryUpdated",
                    Detail: JSON.stringify({
                        categoryId: encryptedCategoryId,
                        marketplaceId: encryptedMarketplaceId,
                        updatedCategory,
                    }),
                },
            ],
        };
        await eventBridge.putEvents(eventBridgeParams).promise();

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Category updated successfully",
                item: updatedCategory,
            }),
        };
    } catch (error) {
        console.error("❌ Error updating category:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Failed to update category", error: error.message }),
        };
    }
};