const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || "Subcategories";

exports.handler = async (event) => {
    console.log("Received event:", JSON.stringify(event, null, 2));

    try {
        // Extract category ID from path parameters
        const categoryId = event.pathParameters?.id;
        if (!categoryId) {
            console.warn(" Missing Category ID in request.");
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Category ID is required." }),
            };
        }

        // DynamoDB Scan Parameters ( Less Efficient)
        const params = {
            TableName: TABLE_NAME,
            FilterExpression: "SK = :categoryId",
            ExpressionAttributeValues: {
                ":categoryId": `CATEGORY#${categoryId}`,
            },
        };

        console.log(" Scanning DynamoDB with params:", JSON.stringify(params, null, 2));

        // Execute Scan
        const result = await dynamoDB.scan(params).promise();

        if (!result.Items || result.Items.length === 0) {
            console.info(`No subcategories found for Category ID: ${categoryId}`);
            return {
                statusCode: 404,
                body: JSON.stringify({ message: "No subcategories found." }),
            };
        }

        // Extract subcategory_data from Items
        const subcategories = result.Items.map((item) => ({
            id: item.PK.replace("SUBCATEGORY#", ""),
            ...item.subcategory_data, // Extract attributes from subcategory_data
        }));

        console.log("Successfully fetched subcategories:", JSON.stringify(subcategories, null, 2));

        return {
            statusCode: 200,
            body: JSON.stringify(subcategories),
        };
    } catch (error) {
        console.error("Error fetching subcategories:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: "Internal Server Error",
                details: error.message,
            }),
        };
    }
};

