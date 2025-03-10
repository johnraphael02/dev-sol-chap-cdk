const AWS = require("aws-sdk");
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const lambda = new AWS.Lambda();

const SUBCATEGORIES_TABLE = process.env.SUBCATEGORIES_TABLE;
const QUEUE_URL = process.env.QUEUE_URL;
const ENCRYPTION_FUNCTION_NAME = "sol-chap-encryption"; // Encryption Lambda Function Name

exports.handler = async (event) => {
    try {
        console.log("Incoming Event:", JSON.stringify(event, null, 2));

        // Extract path parameter and body fields
        const subcategoryId = event.pathParameters?.id;
        const { categoryId, name, description, displayOrder } = JSON.parse(event.body || "{}");

        // Validate required fields
        if (!subcategoryId?.trim() || !categoryId?.trim() || !name?.trim()) {
            console.error("Validation Failed: Missing required fields");
            return sendResponse(400, { message: "Missing required fields: subcategoryId, categoryId, name." });
        }

        const timestamp = new Date().toISOString();

        console.log(`Updating subcategory: ${subcategoryId} under category: ${categoryId}`);

        // Encrypt name and description using the updated encryption Lambda function
        const encryptionParams = {
            FunctionName: ENCRYPTION_FUNCTION_NAME,
            Payload: JSON.stringify({ body: JSON.stringify({ name, description }) }),
        };

        const encryptionResponse = await lambda.invoke(encryptionParams).promise();
        const encryptionResponseParsed = JSON.parse(encryptionResponse.Payload);

        if (encryptionResponseParsed.statusCode >= 400) {
            console.error("Encryption Failed:", encryptionResponseParsed);
            return sendResponse(500, { message: "Failed to encrypt subcategory data" });
        }

        const { name: encryptedName, description: encryptedDescription } = JSON.parse(encryptionResponseParsed.body).encryptedData;

        // Prepare DynamoDB update parameters with encrypted values
        const params = {
            TableName: SUBCATEGORIES_TABLE,
            Key: {
                PK: `SUBCATEGORY#${subcategoryId}`,
                SK: `CATEGORY#${categoryId}`,
            },
            UpdateExpression: "SET subcategory_data.#name = :name, subcategory_data.description = :description, subcategory_data.updated_at = :updatedAt, GSI1PK = :GSI1PK, GSI1SK = :GSI1SK, subcategory_data.displayOrder = :displayOrder",
            ExpressionAttributeNames: {
                "#name": "name", // Alias for reserved keyword
            },
            ExpressionAttributeValues: {
                ":name": encryptedName,
                ":description": encryptedDescription || "",
                ":updatedAt": timestamp,
                ":GSI1PK": `CATEGORY#${categoryId}`,
                ":GSI1SK": `ORDER#${displayOrder}`,
                ":displayOrder": displayOrder || 0,
            },
            ReturnValues: "ALL_NEW",
        };

        console.log("DynamoDB Update Params:", JSON.stringify(params, null, 2));
        const result = await dynamoDB.update(params).promise();
        console.log("Updated Subcategory:", JSON.stringify(result.Attributes, null, 2));

        // Send event to SQS with encrypted values
        const sqsMessage = {
            MessageBody: JSON.stringify({
                action: "update_subcategory",
                subcategoryId,
                categoryId,
                name: encryptedName,
                description: encryptedDescription || "",
                updatedAt: timestamp,
                displayOrder: displayOrder || 0
            }),
            QueueUrl: QUEUE_URL,
        };

        await sqs.sendMessage(sqsMessage).promise();
        console.log("SQS message sent:", sqsMessage);

        return sendResponse(200, {
            message: "Subcategory updated successfully",
            updatedSubcategory: result.Attributes || {},
        });

    } catch (error) {
        console.error("Error updating subcategory:", error);
        return sendResponse(500, { message: "Internal Server Error", error: error.message });
    }
};

// Helper function for responses
const sendResponse = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
});
