const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const eventBridge = new AWS.EventBridge();
const sqs = new AWS.SQS();
const lambda = new AWS.Lambda();

const SUBCATEGORIES_TABLE = process.env.SUBCATEGORIES_TABLE || "Dev-Subcategories";
const QUEUE_URL = process.env.QUEUE_URL;
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
 * Lambda Handler for Deleting a Subcategory
 */
exports.handler = async (event) => {
    try {
        const subcategoryId = event.pathParameters?.id;

        if (!subcategoryId) {
            return { statusCode: 400, body: JSON.stringify({ message: "Missing subcategoryId" }) };
        }

        console.log(`🔑 Subcategory ID to encrypt: ${subcategoryId}`);

        // 🔐 Step 1: Encrypt SUBCATEGORY#<id>
        const encryptedSubcategoryPK = await encryptText(`SUBCATEGORY#${subcategoryId}`);
        console.log(`✅ Encrypted PK: ${encryptedSubcategoryPK}`);

        // 🔎 Step 2: Retrieve subcategory details from DynamoDB
        const getParams = {
            TableName: SUBCATEGORIES_TABLE,
            KeyConditionExpression: "PK = :pk",
            ExpressionAttributeValues: { ":pk": encryptedSubcategoryPK },
        };

        console.log("🔍 Querying DynamoDB with params:", JSON.stringify(getParams, null, 2));

        const result = await dynamoDB.query(getParams).promise();

        if (!result.Items || result.Items.length === 0) {
            console.error("❌ Subcategory not found in DynamoDB.");
            return { statusCode: 404, body: JSON.stringify({ message: "Subcategory not found" }) };
        }

        // 🔎 Step 3: Extract SK
        const subcategoryItem = result.Items[0];
        const encryptedSK = subcategoryItem.SK;

        if (!encryptedSK) {
            return { statusCode: 500, body: JSON.stringify({ message: "Subcategory SK is missing" }) };
        }

        console.log(`🔐 Encrypted SK: ${encryptedSK}`);

        // 🔓 Step 4: Delete the subcategory
        const deleteParams = {
            TableName: SUBCATEGORIES_TABLE,
            Key: { PK: encryptedSubcategoryPK, SK: encryptedSK },
        };

        console.log("🗑️ Deleting subcategory from DynamoDB...");
        await dynamoDB.delete(deleteParams).promise();
        console.log(`✅ Successfully deleted subcategory: ${subcategoryId}`);

        // 📢 Step 5: Publish an event to EventBridge
        const eventParams = {
            Entries: [
                {
                    Source: "aws.marketplace",
                    DetailType: "SubcategoryDeleted",
                    Detail: JSON.stringify({ subcategoryId }),
                    EventBusName: "default",
                },
            ],
        };

        // 📩 Step 6: Send a message to the SQS queue
        const sqsParams = {
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify({ subcategoryId, action: "deleteSubcategory" }),
        };

        // Execute EventBridge & SQS calls in parallel for efficiency
        await Promise.all([
            eventBridge.putEvents(eventParams).promise(),
            sqs.sendMessage(sqsParams).promise(),
        ]);

        console.log(`📢 EventBridge event published & 📩 SQS message sent for deleted subcategory: ${subcategoryId}`);

        return { statusCode: 200, body: JSON.stringify({ message: "Subcategory deleted successfully" }) };
    } catch (error) {
        console.error("❌ Error deleting subcategory:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
