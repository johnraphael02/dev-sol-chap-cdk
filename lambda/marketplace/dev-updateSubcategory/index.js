const AWS = require("aws-sdk");
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();

const SUBCATEGORIES_TABLE = process.env.SUBCATEGORIES_TABLE;
const QUEUE_URL = process.env.QUEUE_URL;

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
                ":name": name,
                ":description": description || "", // Ensure description is a string
                ":updatedAt": timestamp,
                ":GSI1PK": `CATEGORY#${categoryId}`, // Update GSI1PK to reflect the category
                ":GSI1SK": `ORDER#${displayOrder}`, // Update GSI1SK for display order
                ":displayOrder": displayOrder || 0, // Ensure a default displayOrder if not provided
            },
            ReturnValues: "ALL_NEW",
        };

        console.log("DynamoDB Update Params:", JSON.stringify(params, null, 2));
        const result = await dynamoDB.update(params).promise();

        console.log("Updated Subcategory:", JSON.stringify(result.Attributes, null, 2));

        // Send event to SQS
        const sqsMessage = {
            MessageBody: JSON.stringify({
                action: "update_subcategory",
                subcategoryId,
                categoryId,
                name,
                description: description || "",
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
