const AWS = require("aws-sdk");

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();

const TABLE_NAME = process.env.TABLE_NAME;
const DECRYPTION_LAMBDA = "sol-chap-decryption"; // Decryption Lambda function name

/**
 * Invokes the decryption Lambda function to decrypt data.
 */
async function decryptData(encryptedObject) {
    const params = {
        FunctionName: DECRYPTION_LAMBDA,
        InvocationType: "RequestResponse",
        Payload: JSON.stringify({ body: JSON.stringify(encryptedObject) }), // Ensure correct structure
    };

    try {
        console.log("🔑 Sending to Decryption Lambda:", JSON.stringify(encryptedObject, null, 2));

        const response = await lambda.invoke(params).promise();
        console.log("🔑 Raw Decryption Lambda Response:", response);

        if (!response.Payload) {
            throw new Error("Decryption Lambda did not return any payload.");
        }

        let decryptedData;
        try {
            decryptedData = JSON.parse(response.Payload);
        } catch (parseError) {
            throw new Error("Failed to parse Decryption Lambda response.");
        }

        console.log("✅ Parsed Decryption Response:", decryptedData);

        if (decryptedData.statusCode !== 200) {
            console.error(`❌ Decryption failed with status ${decryptedData.statusCode}:`, decryptedData.body);
            return null;
        }

        const parsedBody = JSON.parse(decryptedData.body);
        if (!parsedBody.decryptedData) {
            console.error("❌ Decryption Lambda response is missing 'decryptedData'.");
            return null;
        }

        return parsedBody.decryptedData;
    } catch (error) {
        console.error("❌ Decryption error:", error);
        return null; // Return null instead of throwing an error
    }
}

exports.handler = async () => {
    try {
        console.log("🔍 Fetching encrypted categories from DynamoDB...");

        const params = {
            TableName: TABLE_NAME,
        };

        const result = await dynamoDb.scan(params).promise();

        if (!result.Items || result.Items.length === 0) {
            console.warn("⚠️ No categories found in DynamoDB.");
            return { statusCode: 404, body: JSON.stringify({ message: "No categories found" }) };
        }

        console.log("🔒 Retrieved Encrypted Categories:", JSON.stringify(result.Items, null, 2));

        // Extract and decrypt all categories
        const decryptedCategories = await Promise.all(result.Items.map(async (item) => {
            // Only send necessary fields for decryption (excluding timestamps)
            const encryptedPayload = {
                PK: item.PK,
                SK: item.SK,
                description: item.description,
                GSI1PK: item.GSI1PK,
                GSI1SK: item.GSI1SK,
                name: item.name
            };

            console.log("🔑 Sending for decryption:", JSON.stringify(encryptedPayload, null, 2));

            const decryptedItem = await decryptData(encryptedPayload);

            if (!decryptedItem) {
                console.warn("⚠️ Decryption failed, skipping:", JSON.stringify(item, null, 2));
                return null;
            }

            // Include timestamps without decryption
            return {
                ...decryptedItem,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt
            };
        }));

        // Remove failed decryptions (null values)
        const filteredCategories = decryptedCategories.filter(item => item !== null);

        console.log("✅ Final Decrypted Categories:", JSON.stringify(filteredCategories, null, 2));

        return {
            statusCode: 200,
            body: JSON.stringify(filteredCategories), // Return as normal object
        };
    } catch (error) {
        console.error("❌ Error retrieving categories:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Internal Server Error", error: error.message }),
        };
    }
};
