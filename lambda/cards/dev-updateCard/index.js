const AWS = require("aws-sdk");
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const lambda = new AWS.Lambda();

const TABLE_NAME = process.env.TABLE_NAME || "Dev-Cards";
const QUEUE_URL = process.env.QUEUE_URL;
const ENCRYPTION_LAMBDA = "sol-chap-encryption";

exports.handler = async (event) => {
    try {
        console.log("Received event:", JSON.stringify(event, null, 2));

        const id = event.pathParameters && event.pathParameters.id;
        if (!id) {
            return { statusCode: 400, body: JSON.stringify({ message: "Missing required field: id in path parameters" }) };
        }

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

        const { title, description, userId, paymentType, status } = body;

        if (!title || !description || !userId || !status) {
            return { statusCode: 400, body: JSON.stringify({ message: "Missing required fields: title, description, userId, status" }) };
        }

        console.log("Encrypting provided ID and SK before lookup...");

        let encryptedId, encryptedSK;
        try {
            const encryptionResponse = await lambda.invoke({
                FunctionName: ENCRYPTION_LAMBDA,
                Payload: JSON.stringify({
                    body: JSON.stringify({ id, SK: "METADATA" }) // Encrypt both ID and SK
                })
            }).promise();

            const encryptionResult = JSON.parse(encryptionResponse.Payload);
            if (encryptionResult.statusCode !== 200) {
                throw new Error(`Encryption failed: ${encryptionResult.body}`);
            }

            const parsedBody = JSON.parse(encryptionResult.body);
            encryptedId = parsedBody.encryptedData.id;
            encryptedSK = parsedBody.encryptedData.SK;

            if (!encryptedId || !encryptedSK) {
                throw new Error("Encryption failed: Missing encrypted ID or SK");
            }

            console.log("Encrypted PK:", `CARD#${encryptedId}`);
            console.log("Encrypted SK:", encryptedSK);
        } catch (encryptionError) {
            console.error("Encryption error:", encryptionError);
            return { statusCode: 500, body: JSON.stringify({ message: "Encryption failed" }) };
        }

        console.log("Fetching encrypted ID and SK from DynamoDB...");

        let existingItem;
        try {
            const result = await dynamoDB.get({
                TableName: TABLE_NAME,
                Key: { PK: `CARD#${encryptedId}`, SK: encryptedSK }
            }).promise();
            existingItem = result.Item;

            if (!existingItem) {
                return { statusCode: 404, body: JSON.stringify({ message: "Card not found" }) };
            }
        } catch (dbError) {
            console.error("DynamoDB Fetch Error:", dbError);
            return { statusCode: 500, body: JSON.stringify({ message: "Failed to retrieve existing data", error: dbError.message }) };
        }

        console.log("Valid request. Preparing to encrypt updated fields...");

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

        const timestamp = new Date().toISOString();
        const updateExpression = ["#updatedAt = :updatedAt"];
        const expressionAttributeNames = { "#updatedAt": "updatedAt" };
        const expressionAttributeValues = { ":updatedAt": timestamp };

        if (title) {
            updateExpression.push("#title = :title");
            expressionAttributeNames["#title"] = "title";
            expressionAttributeValues[":title"] = encryptedData.title;
        }
        if (description) {
            updateExpression.push("#description = :description");
            expressionAttributeNames["#description"] = "description";
            expressionAttributeValues[":description"] = encryptedData.description;
        }
        if (userId) {
            updateExpression.push("#userId = :userId");
            expressionAttributeNames["#userId"] = "userId";
            expressionAttributeValues[":userId"] = encryptedData.userId;
        }
        if (status) {
            updateExpression.push("#status = :status");
            expressionAttributeNames["#status"] = "status";
            expressionAttributeValues[":status"] = encryptedData.status;
        }
        if (paymentType) {
            updateExpression.push("#paymentType = :paymentType");
            expressionAttributeNames["#paymentType"] = "paymentType";
            expressionAttributeValues[":paymentType"] = encryptedData.paymentType;
        }

        console.log("DynamoDB Update Parameters:", JSON.stringify(updateExpression, null, 2));

        await dynamoDB.update({
            TableName: TABLE_NAME,
            Key: { PK: `CARD#${encryptedId}`, SK: encryptedSK },
            UpdateExpression: `SET ${updateExpression.join(", ")}`,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: "UPDATED_NEW",
        }).promise();

        console.log("DynamoDB Updated Successfully");

        return { statusCode: 200, body: JSON.stringify({ message: "Card updated successfully", id }) };
    } catch (error) {
        console.error("Unexpected Error:", JSON.stringify(error, null, 2));
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};