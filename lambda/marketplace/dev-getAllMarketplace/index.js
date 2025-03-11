const AWS = require("aws-sdk");

const dynamodb = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();

const MARKETPLACE_TABLE = process.env.MARKETPLACE_TABLE;
const DECRYPTION_LAMBDA = "sol-chap-decryption"; // Name of your decryption Lambda

/**
 * Invokes the decryption Lambda function to decrypt data.
 */
async function decryptData(encryptedObject) {
    const params = {
        FunctionName: DECRYPTION_LAMBDA,
        InvocationType: "RequestResponse",
        Payload: JSON.stringify({ body: JSON.stringify(encryptedObject) }), // Keep same structure as categories reference
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
        return null;
    }
}

/**
 * Handler function to retrieve and decrypt all marketplace records.
 */
exports.handler = async (event) => {
    console.log("📥 Received Event:", JSON.stringify(event));

    try {
        const params = {
            TableName: MARKETPLACE_TABLE,
            FilterExpression: "begins_with(PK, :marketplacePrefix)",
            ExpressionAttributeValues: {
                ":marketplacePrefix": "MARKETPLACE#"
            }
        };

        const result = await dynamodb.scan(params).promise();

        if (!result.Items || result.Items.length === 0) {
            console.warn("⚠️ No marketplace records found in DynamoDB.");
            return {
                statusCode: 404,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "OPTIONS, GET",
                    "Access-Control-Allow-Headers": "Content-Type",
                },
                body: JSON.stringify({ message: "No marketplace records found" }),
            };
        }

        console.log("🔒 Retrieved Encrypted Marketplace Records:", JSON.stringify(result.Items, null, 2));

        // Decrypt each marketplace record
        const decryptedItems = await Promise.all(result.Items.map(async (item) => {
            // Only pass fields that need decryption
            const encryptedPayload = {
                PK: item.PK,
                SK: item.SK,
                name: item.name,
                description: item.description,
                category: item.category,
                GSI1PK: item.GSI1PK,
                GSI1SK: item.GSI1SK
            };

            console.log("🔑 Sending for decryption:", JSON.stringify(encryptedPayload, null, 2));

            const decryptedItem = await decryptData(encryptedPayload);

            if (!decryptedItem) {
                console.warn("⚠️ Decryption failed, skipping item:", JSON.stringify(item, null, 2));
                return null;
            }

            // Append unencrypted fields such as timestamps
            return {
                ...decryptedItem,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt
            };
        }));

        // Filter out failed decryptions
        const filteredItems = decryptedItems.filter(item => item !== null);

        console.log("✅ Final Decrypted Marketplace Records:", JSON.stringify(filteredItems, null, 2));

        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "OPTIONS, GET",
                "Access-Control-Allow-Headers": "Content-Type",
            },
            body: JSON.stringify({
                message: "Marketplace data retrieved successfully.",
                data: filteredItems
            }),
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
            body: JSON.stringify({ message: "Internal Server Error", error: error.message }),
        };
    }
};
