const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const dynamoDb = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event) => {
    try {
        const requestBody = JSON.parse(event.body);
        const categoryId = uuidv4(); // Generate unique category ID
        const marketplaceId = requestBody.marketplaceId; // Expect marketplace ID from request

        // Validate required fields
        if (!requestBody.name || !marketplaceId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Missing required fields: name and marketplaceId" }),
            };
        }

        const timestamp = new Date().toISOString();

        // Define category structure
        const newCategory = {
            PK: `CATEGORY#${categoryId}`,
            SK: `MARKETPLACE#${marketplaceId}`,
            GSI1PK: `MARKETPLACE#${marketplaceId}`,
            GSI1SK: `CATEGORY#${categoryId}`,
            category_data: {
                name: requestBody.name,
                description: requestBody.description || "",
                created_at: timestamp,
                updated_at: timestamp
            }
        };

        const params = {
            TableName: TABLE_NAME,
            Item: newCategory,
        };

        await dynamoDb.put(params).promise();

        return {
            statusCode: 201,
            body: JSON.stringify({
                message: "Category created successfully",
                categoryId,
                marketplaceId
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
