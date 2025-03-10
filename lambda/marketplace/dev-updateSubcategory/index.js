const AWS = require("aws-sdk");
const dynamodb = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();

const SUBCATEGORIES_TABLE = process.env.SUBCATEGORIES_TABLE;
const QUEUE_URL = process.env.QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;
const ENCRYPTION_LAMBDA = "sol-chap-encryption"; // Encryption Lambda function name

/**
 * Encrypts text using the encryption Lambda function.
 */
async function encryptText(text) {
    console.log(`🔑 Encrypting text: ${text}`);

    const params = {
        FunctionName: ENCRYPTION_LAMBDA,
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
        // Extract subcategoryId from path parameters
        const subcategoryId = event.pathParameters?.id;
        const requestBody = JSON.parse(event.body);

        if (!subcategoryId || !requestBody.categoryId || !requestBody.name || requestBody.displayOrder === undefined) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Missing required fields: subcategoryId, categoryId, name, displayOrder" }),
            };
        }

        console.log(`🔑 Encrypting input subcategoryId: SUBCATEGORY#${subcategoryId}`);
        console.log(`🔑 Encrypting input categoryId: CATEGORY#${requestBody.categoryId}`);

        // Encrypt subcategoryId and categoryId
        const encryptedSubcategoryId = await encryptText(`SUBCATEGORY#${subcategoryId}`);
        const encryptedCategoryId = await encryptText(`CATEGORY#${requestBody.categoryId}`);

        console.log(`🔎 Searching for subcategory with encrypted ID: ${encryptedSubcategoryId}`);

        // Step 1: Retrieve subcategory from DynamoDB to ensure it exists
        const getParams = {
            TableName: SUBCATEGORIES_TABLE,
            KeyConditionExpression: "PK = :pk AND SK = :sk",
            ExpressionAttributeValues: {
                ":pk": encryptedSubcategoryId,
                ":sk": encryptedCategoryId,
            },
        };

        const result = await dynamodb.query(getParams).promise();

        if (!result.Items || result.Items.length === 0) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: "Subcategory not found" }),
            };
        }

        console.log("✅ Subcategory exists, proceeding with update.");

        // Step 2: Encrypt updated fields
        const [encryptedName, encryptedDescription, encryptedDisplayOrder] = await Promise.all([
            encryptText(requestBody.name),
            encryptText(requestBody.description || ""),
            encryptText(`ORDER#${requestBody.displayOrder}`),
        ]);

        const timestamp = new Date().toISOString();

        // Step 3: Encrypt PK and SK before storing
        const encryptedPK = await encryptText(`SUBCATEGORY#${subcategoryId}`);
        const encryptedSK = await encryptText(`CATEGORY#${requestBody.categoryId}`);

        // Step 4: Update the subcategory in DynamoDB
        const updateParams = {
            TableName: SUBCATEGORIES_TABLE,
            Key: {
                PK: encryptedPK,
                SK: encryptedSK,
            },
            UpdateExpression: "SET #name = :name, description = :description, updated_at = :updatedAt, displayOrder = :displayOrder",
            ExpressionAttributeNames: {
                "#name": "name",
            },
            ExpressionAttributeValues: {
                ":name": encryptedName,
                ":description": encryptedDescription,
                ":displayOrder": encryptedDisplayOrder,
                ":updatedAt": timestamp,
            },
            ReturnValues: "ALL_NEW",
        };

        const updateResult = await dynamodb.update(updateParams).promise();
        const updatedSubcategory = updateResult.Attributes;

        console.log("✅ Subcategory updated successfully:", updatedSubcategory);

        // Step 5: Send encrypted update to SQS
        const sqsMessage = {
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify({
                eventType: "SUBCATEGORY_UPDATED",
                subcategoryId: encryptedSubcategoryId,
                categoryId: encryptedCategoryId,
                updatedSubcategory,
            }),
        };
        await sqs.sendMessage(sqsMessage).promise();

        // Step 6: Publish encrypted update to EventBridge
        const eventBridgeParams = {
            Entries: [
                {
                    EventBusName: EVENT_BUS_NAME,
                    Source: "custom.subcategory.service",
                    DetailType: "SubcategoryUpdated",
                    Detail: JSON.stringify({
                        subcategoryId: encryptedSubcategoryId,
                        categoryId: encryptedCategoryId,
                        updatedSubcategory,
                    }),
                },
            ],
        };
        await eventBridge.putEvents(eventBridgeParams).promise();

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Subcategory updated successfully",
                item: updatedSubcategory,
            }),
        };
    } catch (error) {
        console.error("❌ Error updating subcategory:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Failed to update subcategory", error: error.message }),
        };
    }
};
