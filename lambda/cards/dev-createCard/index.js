const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const lambda = new AWS.Lambda();

const TABLE_NAME = process.env.TABLE_NAME || "Dev-Cards";
const QUEUE_URL = process.env.QUEUE_URL;
const ENCRYPTION_LAMBDA = "sol-chap-encryption";

exports.handler = async (event) => {
    try {
        console.log("Received event:", JSON.stringify(event, null, 2));

        if (!event.body) {
            return { statusCode: 400, body: JSON.stringify({ message: "Request body is required" }) };
        }

        let body;
        try {
            body = JSON.parse(event.body);
        } catch (error) {
            console.error("JSON Parse Error:", error);
            return { statusCode: 400, body: JSON.stringify({ message: "Invalid JSON format" }) };
        }

        const { id, title, description, userId, paymentType, status } = body;

        if (!id || !title || !description || !userId || !status) {
            return { statusCode: 400, body: JSON.stringify({ message: "Missing required fields: id, title, description, userId, status" }) };
        }

        console.log("Valid request. Preparing to encrypt...");

        // Encrypt the required fields using Lambda
        let encryptedData;
        try {
            const encryptionResponse = await lambda.invoke({
                FunctionName: ENCRYPTION_LAMBDA,
                Payload: JSON.stringify({
                    body: JSON.stringify({ id, title, description, userId, paymentType, status, SK: "METADATA" })
                })
            }).promise();

            const encryptionResult = JSON.parse(encryptionResponse.Payload);
            if (encryptionResult.statusCode !== 200) {
                throw new Error(`Encryption failed: ${encryptionResult.body}`);
            }

            const parsedBody = JSON.parse(encryptionResult.body);
            encryptedData = parsedBody.encryptedData;

            if (!encryptedData || !encryptedData.id || !encryptedData.title || !encryptedData.userId || !encryptedData.SK) {
                throw new Error("Encryption failed: Missing encrypted fields");
            }
        } catch (encryptionError) {
            console.error("Encryption error:", encryptionError);
            return { statusCode: 500, body: JSON.stringify({ message: "Encryption failed" }) };
        }

        // Construct item for DynamoDB
        const timestamp = new Date().toISOString();
        const item = {
            PK: `CARD#${encryptedData.id}`,
            SK: encryptedData.SK,
            GSI1PK: `STATUS#${encryptedData.status}`,
            GSI1SK: `CARD#${encryptedData.id}`,
            GSI2PK: `USER#${encryptedData.userId}`,
            GSI2SK: `CREATED_AT#${timestamp}`,
            title: encryptedData.title,
            description: encryptedData.description,
            userId: encryptedData.userId,
            status: encryptedData.status,
            createdAt: timestamp,
        };

        if (encryptedData.paymentType) {
            item.paymentType = encryptedData.paymentType;
        }

        console.log("DynamoDB Item to Insert:", JSON.stringify(item, null, 2));

        try {
            await dynamoDB.put({ TableName: TABLE_NAME, Item: item }).promise();
            console.log("DynamoDB Inserted Successfully");
        } catch (dbError) {
            console.error("DynamoDB Insert Failed:", JSON.stringify(dbError, null, 2));
            return {
                statusCode: 500,
                body: JSON.stringify({ message: "DynamoDB Insert Failed", error: dbError.message }),
            };
        }

        // Send event to SQS queue
        const sqsMessage = {
            MessageBody: JSON.stringify({ id: encryptedData.id, title: encryptedData.title, userId: encryptedData.userId, status: encryptedData.status }),
            QueueUrl: QUEUE_URL,
        };

        await sqs.sendMessage(sqsMessage).promise();
        console.log("SQS message sent:", sqsMessage);

        return { statusCode: 201, body: JSON.stringify({ message: "Card created successfully", id }) };
    } catch (error) {
        console.error("Unexpected Error:", JSON.stringify(error, null, 2));
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};
