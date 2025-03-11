const AWS = require("aws-sdk");
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const lambda = new AWS.Lambda();

// Environment variables
const MESSAGES_TABLE = process.env.MESSAGES_TABLE;
const SUBJECT_QUEUE_URL = process.env.QUEUE_URL;
const ENCRYPTION_FUNCTION = "sol-chap-encryption"; // Encryption Lambda function

/**
 * Calls the encryption Lambda function
 */
const encrypt = async (data) => {
    try {
        if (!data || typeof data !== "string") {
            console.error("Encryption Error: Invalid input data", data);
            throw new Error("Invalid data for encryption");
        }

        const params = {
            FunctionName: ENCRYPTION_FUNCTION,
            Payload: JSON.stringify({ data }),
        };

        const response = await lambda.invoke(params).promise();
        console.log("Encryption Lambda Response:", response);

        const payload = JSON.parse(response.Payload);
        if (payload.statusCode !== 200 || !payload.body) {
            throw new Error("Encryption Lambda returned an invalid response");
        }

        const body = JSON.parse(payload.body);
        if (!body.encryptedData || !body.encryptedData.data) {
            throw new Error("Invalid encryption format");
        }

        return body.encryptedData.data; // Extract encrypted data
    } catch (error) {
        console.error("Encryption Error:", error);
        throw new Error("Encryption failed");
    }
};

/**
 * Lambda Function: reviewSubject
 * Updates a message subject in the Messages table.
 */
exports.handler = async (event) => {
    try {
        console.log("Incoming Event:", JSON.stringify(event, null, 2));

        const body = JSON.parse(event.body || "{}");
        const { messageId, subject } = body;

        // Validate input fields
        if (!messageId?.trim() || !subject?.trim()) {
            console.error("Validation Failed: Missing or empty required fields");
            return sendResponse(400, { message: "Missing or empty required fields: messageId, subject." });
        }

        const timestamp = new Date().toISOString();

        // Encrypt sensitive fields using Lambda
        const encryptedMessageId = await encrypt(messageId);
        const encryptedSubject = await encrypt(subject);
        const encryptedPK = await encrypt(`MESSAGE#${messageId}`);
        const encryptedSK = await encrypt("SUBJECT");

        // Ensure encrypted values are not undefined
        if (!encryptedMessageId || !encryptedSubject || !encryptedPK || !encryptedSK) {
            console.error("Encryption returned undefined values");
            return sendResponse(500, { message: "Encryption failed. Please try again." });
        }

        const params = {
            TableName: MESSAGES_TABLE,
            Key: { PK: encryptedPK, SK: encryptedSK },
            UpdateExpression: "SET #s = :subject, updatedAt = :updatedAt",
            ExpressionAttributeNames: { "#s": "subject" },
            ExpressionAttributeValues: {
                ":subject": encryptedSubject,
                ":updatedAt": timestamp,
            },
            ReturnValues: "UPDATED_NEW",
        };

        console.log("DynamoDB Update Params:", JSON.stringify(params, null, 2));

        // Update DynamoDB
        const result = await dynamoDB.update(params).promise();

        console.log("Updated Subject:", JSON.stringify(result.Attributes, null, 2));

        // Send event to SQS
        const sqsParams = {
            QueueUrl: SUBJECT_QUEUE_URL,
            MessageBody: JSON.stringify({
                action: "SUBJECT_UPDATED",
                messageId: encryptedMessageId,
                subject: encryptedSubject,
                updatedAt: timestamp,
            }),
        };

        console.log("SQS Send Params:", JSON.stringify(sqsParams, null, 2));
        await sqs.sendMessage(sqsParams).promise();

        return sendResponse(200, {
            message: "Subject updated successfully",
            updatedSubject: result.Attributes || {},
        });

    } catch (error) {
        console.error("Error updating message subject:", error);
        return sendResponse(500, { message: "Internal Server Error", error: error.message });
    }
};

// Helper function for responses
const sendResponse = (statusCode, body) => ({
    statusCode,
    body: JSON.stringify(body),
});
