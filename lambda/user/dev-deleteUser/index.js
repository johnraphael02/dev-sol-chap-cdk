const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();

const USERS_TABLE = 'Users'; // Adjust accordingly
const DEV_USERS_TABLE = 'Dev-Users'; // Adjust accordingly
const ENCRYPTION_LAMBDA = 'sol-chap-encryption'; // Your encryption Lambda name

// 🔐 Encrypt a field using encryption Lambda
const encryptField = async (text) => {
    const params = {
        FunctionName: ENCRYPTION_LAMBDA,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify({
            body: JSON.stringify({ text })
        }),
    };

    try {
        const response = await lambda.invoke(params).promise();
        const parsed = JSON.parse(response.Payload);
        const encrypted = JSON.parse(parsed.body).encryptedData;
        if (!encrypted) throw new Error('Missing encryptedData');
        return encrypted;
    } catch (error) {
        console.error('🔐 Encryption Error:', error.message);
        throw error;
    }
};

exports.handler = async (event) => {
    try {
        const userId = event.pathParameters?.id;
        if (!userId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "User ID is required." })
            };
        }

        // 🔐 Step 1: Encrypt the userId
        const encryptedUserId = await encryptField(userId);
        const userPK = `USER#${encryptedUserId}`;

        // 🔍 Step 2: Query Dev-Users table to get SK dynamically
        const queryParams = {
            TableName: DEV_USERS_TABLE,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: { ':pk': userPK }
        };

        const queryResult = await docClient.query(queryParams).promise();

        if (!queryResult.Items || queryResult.Items.length === 0) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: "User not found." })
            };
        }

        const userSK = queryResult.Items[0].SK;

        // ❌ Step 3: Delete the user from Users table using encrypted PK and SK
        const deleteParams = {
            TableName: USERS_TABLE,
            Key: { PK: userPK, SK: userSK }
        };

        await docClient.delete(deleteParams).promise();

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "User account deleted successfully." })
        };

    } catch (error) {
        console.error("❌ Error deleting user:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Internal server error." })
        };
    }
};
