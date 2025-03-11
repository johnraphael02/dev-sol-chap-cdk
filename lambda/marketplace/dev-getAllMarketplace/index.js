const AWS = require("aws-sdk");

// Initialize AWS services
const dynamodb = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();
const decryptionFunction = "sol-chap-decryption";

// Environment Variables
const MARKETPLACE_TABLE = process.env.MARKETPLACE_TABLE;

// Function to invoke decryption Lambda
async function decryptData(data) {
    const params = {
        FunctionName: decryptionFunction,
        Payload: JSON.stringify(data),
    };

    const response = await lambda.invoke(params).promise();
    console.log("Decryption Lambda Raw Response:", response);

    try {
        const decryptedResponse = JSON.parse(response.Payload);
        console.log("Parsed Decryption Response:", decryptedResponse);

        if (decryptedResponse.statusCode !== 200) {
            throw new Error(`Decryption failed: ${decryptedResponse.body}`);
        }

        const decryptedData = JSON.parse(decryptedResponse.body).decryptedData;
        console.log("Final Decrypted Data:", decryptedData);

        return decryptedData;
    } catch (error) {
        console.error("Error parsing decryption response:", error);
        throw new Error("Decryption Lambda response is invalid");
    }
}

// Handler function to retrieve all marketplace records
exports.handler = async (event) => {
    console.log("🔍 Received Event:", JSON.stringify(event));

    try {
        const params = {
            TableName: MARKETPLACE_TABLE,
            FilterExpression: "begins_with(PK, :marketplacePrefix)",
            ExpressionAttributeValues: {
                ":marketplacePrefix": "MARKETPLACE#"
            }
        };

        const result = await dynamodb.scan(params).promise();
        console.log("Retrieved Data from DynamoDB:", result.Items);

        // Decrypt all marketplace records
        const decryptedItems = await Promise.all(result.Items.map(async (item) => {
            return await decryptData(item);
        }));

        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "OPTIONS, GET",
                "Access-Control-Allow-Headers": "Content-Type",
            },
            body: JSON.stringify({ message: "Marketplace data retrieved successfully.", data: decryptedItems }),
        };
    } catch (error) {
        console.error("🚨 Error retrieving marketplace data:", error);
        return {
            statusCode: 500,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "OPTIONS, GET",
                "Access-Control-Allow-Headers": "Content-Type",
            },
            body: JSON.stringify({ message: "Could not retrieve marketplace data", error: error.message }),
        };
    }
};