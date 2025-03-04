const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event) => {
    try {
        const userId = event.pathParameters?.id;
        if (!userId) {
            return { statusCode: 400, body: JSON.stringify({ message: "User ID is required." }) };
        }

        const userPK = `USER#${userId}`;

        // 🚀 Step 1: Get the User's SK Dynamically
        const queryParams = {
            TableName: 'Users',
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: { ':pk': userPK }
        };

        const queryResult = await docClient.query(queryParams).promise();

        if (queryResult.Items.length === 0) {
            return { statusCode: 404, body: JSON.stringify({ message: "User not found." }) };
        }

        // Extract the SK dynamically
        const userSK = queryResult.Items[0].SK;

        // 🚀 Step 2: Delete User using dynamic SK
        const deleteUserParams = {
            TableName: 'Users',
            Key: { PK: userPK, SK: userSK }
        };

        await docClient.delete(deleteUserParams).promise();

        return { statusCode: 200, body: JSON.stringify({ message: "User account deleted successfully." }) };
    } catch (error) {
        console.error("Error deleting user:", error);
        return { statusCode: 500, body: JSON.stringify({ message: "Internal server error." }) };
    }
};
