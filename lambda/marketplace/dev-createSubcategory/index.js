const AWS = require("aws-sdk");
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const lambda = new AWS.Lambda();

const TABLE_NAME = process.env.TABLE_NAME;
const QUEUE_URL = process.env.QUEUE_URL;
const ENCRYPTION_LAMBDA = "sol-chap-encryption";

exports.handler = async (event) => {
    console.log("Received event:", JSON.stringify(event, null, 2));

    try {
        if (!event.body) {
            return sendResponse(400, { message: "Request body is required" });
        }

        const body = JSON.parse(event.body);

        if (!body.subcategoryId || !body.categoryId || !body.name || body.displayOrder === undefined) {
            return sendResponse(400, { message: "Missing required fields: subcategoryId, categoryId, name, displayOrder" });
        }

        const timestamp = new Date().toISOString();

        // Encrypt necessary fields
        const encryptedBody = await encryptObject({
            name: body.name,
            description: body.description || "",
        });

        const encryptedKeys = await encryptObject({
            PK: `SUBCATEGORY#${body.subcategoryId}`,
            SK: `CATEGORY#${body.categoryId}`,
            GSI1PK: `CATEGORY#${body.categoryId}`,
            GSI1SK: `ORDER#${body.displayOrder}`,
        });

        // Flattened DynamoDB item
        const item = {
            PK: encryptedKeys.PK,
            SK: encryptedKeys.SK,
            GSI1PK: encryptedKeys.GSI1PK,
            GSI1SK: encryptedKeys.GSI1SK,
            name: encryptedBody.name,
            description: encryptedBody.description,
            displayOrder: body.displayOrder,
            created_at: timestamp,
            updated_at: timestamp,
        };

        await dynamoDB.put({ TableName: TABLE_NAME, Item: item }).promise();
        console.log("✅ DynamoDB entry added:", item);

        // Send event to SQS
        const sqsMessage = {
            MessageBody: JSON.stringify({
                subcategoryId: body.subcategoryId,
                categoryId: body.categoryId,
                name: encryptedBody.name,
                description: encryptedBody.description,
                displayOrder: body.displayOrder,
            }),
            QueueUrl: QUEUE_URL,
        };

        await sqs.sendMessage(sqsMessage).promise();
        console.log("✅ SQS message sent:", sqsMessage);

        return sendResponse(200, { message: "Subcategory created successfully", item });

    } catch (error) {
        console.error("❌ Error creating subcategory:", error);
        return sendResponse(500, { message: "Internal Server Error", error: error.message });
    }
};

// 🔐 Encrypt object via Lambda function
async function encryptObject(obj) {
    try {
        const encryptionPayload = {
            FunctionName: ENCRYPTION_LAMBDA,
            InvocationType: "RequestResponse",
            Payload: JSON.stringify({ body: JSON.stringify(obj) }),
        };

        const encryptionResponse = await lambda.invoke(encryptionPayload).promise();
        console.log("🔹 Full Encryption Lambda Response:", encryptionResponse);

        if (!encryptionResponse.Payload) {
            throw new Error("Encryption Lambda did not return any payload.");
        }

        let encryptedData;
        try {
            encryptedData = JSON.parse(encryptionResponse.Payload);
        } catch (parseError) {
            throw new Error("Failed to parse Encryption Lambda response.");
        }

        console.log("🔹 Parsed Encryption Response:", encryptedData);

        if (encryptedData.statusCode >= 400) {
            throw new Error("Encryption Lambda returned an error status.");
        }

        const parsedBody = JSON.parse(encryptedData.body);
        if (!parsedBody.encryptedData) {
            throw new Error("Encryption Lambda response is missing 'encryptedData'.");
        }

        return parsedBody.encryptedData;
    } catch (error) {
        console.error("❌ Encryption error:", error);
        throw error;
    }
}

// 📌 Helper function for responses
const sendResponse = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
});
