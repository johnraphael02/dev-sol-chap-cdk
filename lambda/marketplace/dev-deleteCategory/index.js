const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const eventBridge = new AWS.EventBridge();
const sqs = new AWS.SQS();
const lambda = new AWS.Lambda();

const TABLE_NAME = process.env.TABLE_NAME || "Dev-Categories";
const DELETE_CATEGORY_QUEUE_URL = process.env.DELETE_CATEGORY_QUEUE_URL;
const ENCRYPTION_LAMBDA = "sol-chap-encryption"; // Lambda for encryption

/**
 * Invokes the encryption Lambda function.
 */
const encryptText = async (text) => {
    console.log(`🔑 Encrypting text: ${text}`);

    const params = {
        FunctionName: ENCRYPTION_LAMBDA,
        InvocationType: "RequestResponse",
        Payload: JSON.stringify({ PK: text }), // Ensure consistency with encryption Lambda
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
 * Lambda Handler for Deleting a Category
 */
exports.handler = async (event) => {
    try {
        const categoryId = event.pathParameters?.id;

        if (!categoryId) {
            return { statusCode: 400, body: JSON.stringify({ message: "Missing categoryId" }) };
        }

        console.log(`🔑 Category ID to encrypt: ${categoryId}`);

        // Step 1: Call the AES Decryption Lambda function
        const lambdaParams = {
            FunctionName: "aes-decryption",
            Payload: JSON.stringify({ encryptedText: encryptedCategoryId }),
        };
        const lambdaResponse = await lambda.invoke(lambdaParams).promise();
        const decryptedData = JSON.parse(lambdaResponse.Payload);

        if (!decryptedData || !decryptedData.decryptedText) {
            return { statusCode: 500, body: JSON.stringify({ message: "Decryption failed" }) };
        }

        const categoryId = decryptedData.decryptedText;
        console.log(`✅ Decrypted Category ID: ${categoryId}`);

        // 🔎 Step 2: Retrieve category details from DynamoDB
        const getParams = {
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk",
            ExpressionAttributeValues: { ":pk": encryptedCategoryPK },
        };

        console.log("🔍 Querying DynamoDB with params:", JSON.stringify(getParams, null, 2));

        const result = await dynamoDB.query(getParams).promise();

        if (!result.Items || result.Items.length === 0) {
            console.error("❌ Category not found in DynamoDB.");
            return { statusCode: 404, body: JSON.stringify({ message: "Category not found" }) };
        }

        // 🔎 Step 3: Extract SK
        const categoryItem = result.Items[0];
        const encryptedSK = categoryItem.SK;

        if (!encryptedSK) {
            return { statusCode: 500, body: JSON.stringify({ message: "Category SK is missing" }) };
        }

        console.log(`🔐 Encrypted SK: ${encryptedSK}`);

        // 🔓 Step 4: Delete the category
        const deleteParams = {
            TableName: TABLE_NAME,
            Key: { PK: encryptedCategoryPK, SK: encryptedSK },
        };

        console.log("🗑️ Deleting category from DynamoDB...");
        await dynamoDB.delete(deleteParams).promise();
        console.log(`✅ Successfully deleted category: ${categoryId}`);

        // 📢 Step 5: Publish an event to EventBridge
        const eventParams = {
            Entries: [
                {
                    Source: "aws.marketplace",
                    DetailType: "CategoryDeleted",
                    Detail: JSON.stringify({ categoryId }),
                    EventBusName: "default",
                },
            ],
        };

        // 📩 Step 6: Send a message to the SQS queue
        const sqsParams = {
            QueueUrl: DELETE_CATEGORY_QUEUE_URL,
            MessageBody: JSON.stringify({ categoryId, action: "deleteCategory" }),
        };

        // Execute EventBridge & SQS calls in parallel for efficiency
        await Promise.all([
            eventBridge.putEvents(eventParams).promise(),
            sqs.sendMessage(sqsParams).promise(),
        ]);

        console.log(`📢 EventBridge event published & 📩 SQS message sent for deleted category: ${categoryId}`);

        return { statusCode: 200, body: JSON.stringify({ message: "Category deleted successfully" }) };
    } catch (error) {
        console.error("❌ Error deleting category:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
