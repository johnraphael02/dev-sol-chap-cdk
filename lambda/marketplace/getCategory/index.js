const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event) => {
    try {
        // Scan DynamoDB Table to get all categories
        const params = {
            TableName: TABLE_NAME,
            FilterExpression: "begins_with(PK, :pkPrefix)", // Filter categories by PK
            ExpressionAttributeValues: {
                ":pkPrefix": "CATEGORY#",
            },
        };

        const result = await dynamoDb.scan(params).promise();

        if (!result.Items || result.Items.length === 0) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: 'No categories found' }),
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify(result.Items),
        };
    } catch (error) {
        console.error('Error:', error);  // Log the error for debugging
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal Server Error', error: error.message }),
        };
    }
};
