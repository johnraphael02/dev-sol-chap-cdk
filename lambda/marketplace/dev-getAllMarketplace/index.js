const AWS = require("aws-sdk");

const dynamodb = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();

const MARKETPLACE_TABLE = process.env.MARKETPLACE_TABLE;
const DECRYPTION_LAMBDA = "sol-chap-decryption";

/**
 * Invokes the decryption Lambda function to decrypt data.
 */
async function decryptData(encryptedObject) {
    const params = {
        FunctionName: DECRYPTION_LAMBDA,
        InvocationType: "RequestResponse",
        Payload: JSON.stringify({ body: JSON.stringify(encryptedObject) }),
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
        console.log("🔍 Fetching encrypted Marketplace items...");

        const result = await dynamodb.scan({ TableName: MARKETPLACE_TABLE }).promise();
        const encryptedItems = result.Items || [];

        console.log("🔒 Retrieved Encrypted Items:", JSON.stringify(encryptedItems, null, 2));

        const decryptedItems = await Promise.all(
            encryptedItems.map(async (item) => {
                const encryptedPayload = {
                    PK: item.PK,
                    SK: item.SK,
                    name: item.name,
                    description: item.description,
                    GSI1PK: item.GSI1PK,
                    GSI1SK: item.GSI1SK,
                };

                console.log("🔑 Sending for decryption:", JSON.stringify(encryptedPayload, null, 2));

                const decryptedItem = await decryptData(encryptedPayload);
                if (!decryptedItem) {
                    console.warn("⚠️ Decryption failed, skipping:", JSON.stringify(item, null, 2));
                    return null;
                }

                return {
                    ...decryptedItem,
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt,
                };
            })
        );

        const filteredItems = decryptedItems.filter(item => item !== null);

        console.log("✅ Final Decrypted Marketplace Items:", JSON.stringify(filteredItems, null, 2));

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Fetched and decrypted marketplace items successfully", data: filteredItems }),
        };
    } catch (error) {
        console.error("❌ Error retrieving marketplace items:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Internal Server Error", error: error.message }),
        };
    }
};
