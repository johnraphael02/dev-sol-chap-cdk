const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();

const SUBCATEGORIES_TABLE = process.env.SUBCATEGORIES_TABLE || "Dev-Subcategories";
const ENCRYPTION_LAMBDA = "sol-chap-encryption"; // Lambda for encryption
const DECRYPTION_LAMBDA = "sol-chap-decryption"; // Lambda for decryption

/**
 * Invokes the encryption Lambda function to encrypt categoryId.
 */
const encryptCategoryId = async (categoryId) => {
    console.log(`🔑 Encrypting CATEGORY#${categoryId} before querying DynamoDB...`);

    const params = {
        FunctionName: ENCRYPTION_LAMBDA,
        InvocationType: "RequestResponse",
        Payload: JSON.stringify({ PK: `CATEGORY#${categoryId}` }), // Ensure consistency with encryption Lambda
    };

    try {
        const response = await lambda.invoke(params).promise();
        console.log("🔒 Raw Encryption Lambda Response:", response);

        const payload = JSON.parse(response.Payload);
        console.log("🔒 Parsed Encryption Response:", payload);

        if (!payload || !payload.body) {
            throw new Error("Invalid encryption response");
        }

        const encryptedData = JSON.parse(payload.body);
        if (!encryptedData.encryptedData || !encryptedData.encryptedData.PK) {
            throw new Error("Encryption failed, missing PK field");
        }

        return encryptedData.encryptedData.PK; // Ensure correct field usage
    } catch (error) {
        console.error("❌ Error in encryption function:", error);
        throw new Error("Encryption Lambda response is invalid");
    }
};

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
        return null;
    }
}

/**
 * Lambda Handler for Fetching Subcategories by Encrypted Category ID
 */
exports.handler = async (event) => {
    console.log("Received event:", JSON.stringify(event, null, 2));

    try {
        // Extract category ID from path parameters
        const categoryId = event.pathParameters?.id;
        if (!categoryId) {
            console.warn("⚠️ Missing Category ID in request.");
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Category ID is required." }),
            };
        }

        // Encrypt categoryId before querying DynamoDB
        const encryptedCategoryId = await encryptCategoryId(categoryId);

        if (!encryptedCategoryId) {
            return {
                statusCode: 500,
                body: JSON.stringify({ message: "Failed to encrypt category ID" }),
            };
        }

        console.log("🔑 Encrypted Category ID for lookup:", encryptedCategoryId);

        // DynamoDB Scan Parameters (Less Efficient but needed due to encrypted data)
        const params = {
            TableName: SUBCATEGORIES_TABLE,
            FilterExpression: "SK = :categoryId",
            ExpressionAttributeValues: {
                ":categoryId": encryptedCategoryId, // Use encrypted ID
            },
        };

        console.log("🔍 Scanning DynamoDB with params:", JSON.stringify(params, null, 2));

        // Execute Scan
        const result = await dynamoDB.scan(params).promise();

        if (!result.Items || result.Items.length === 0) {
            console.info(`⚠️ No subcategories found for Category ID: ${categoryId}`);
            return {
                statusCode: 404,
                body: JSON.stringify({ message: "No subcategories found." }),
            };
        }

        console.log("🔒 Retrieved Encrypted Subcategories:", JSON.stringify(result.Items, null, 2));

        // Decrypt all subcategory data
        const decryptedSubcategories = await Promise.all(result.Items.map(async (item) => {
            // Remove timestamps from decryption payload
            const encryptedPayload = {
                PK: item.PK,
                SK: item.SK,
                description: item.description,
                GSI1PK: item.GSI1PK,
                GSI1SK: item.GSI1SK,
                name: item.name
            };

            console.log("🔑 Sending Subcategory for Decryption:", JSON.stringify(encryptedPayload, null, 2));

            const decryptedItem = await decryptData(encryptedPayload);

            if (!decryptedItem) {
                console.warn("⚠️ Decryption failed, skipping:", JSON.stringify(item, null, 2));
                return null;
            }

            return {
                id: decryptedItem.PK.replace("SUBCATEGORY#", ""), // Remove prefix
                ...decryptedItem,
                createdAt: item.createdAt, // Keep timestamps unencrypted
                updatedAt: item.updatedAt
            };
        }));

        // Remove failed decryptions (null values)
        const filteredSubcategories = decryptedSubcategories.filter(item => item !== null);

        console.log("✅ Final Decrypted Subcategories:", JSON.stringify(filteredSubcategories, null, 2));

        return {
            statusCode: 200,
            body: JSON.stringify(filteredSubcategories),
        };
    } catch (error) {
        console.error("❌ Error fetching subcategories:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Internal Server Error", details: error.message }),
        };
    }
};
