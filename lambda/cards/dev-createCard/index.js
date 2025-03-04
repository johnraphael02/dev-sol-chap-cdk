const AWS = require("aws-sdk");
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();

const TABLE_NAME = process.env.CARDS_TABLE_NAME || "Cards";
const QUEUE_URL = process.env.QUEUE_URL;
const COGNITO_POOL = process.env.COGNITO_POOL;
const EVENTBRIDGE_RULE = process.env.EVENTBRIDGE_RULE;

exports.handler = async (event) => {
    try {
        console.log("Received event:", JSON.stringify(event, null, 2));

        if (!event.body) {
            return { statusCode: 400, body: JSON.stringify({ message: "Request body is required" }) };
        }

        let body;
        try {
            body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
        } catch (error) {
            console.error("JSON Parse Error:", error);
            return { statusCode: 400, body: JSON.stringify({ message: "Invalid JSON format" }) };
        }

        // Extract required fields
        const { id, title, description, userId, paymentType, status } = body;

        if (!id || typeof id !== "string" || id.trim() === "") {
            return { statusCode: 400, body: JSON.stringify({ message: "Missing or invalid required field: id" }) };
        }

        if (!title || !description || !userId || !status) {
            return { statusCode: 400, body: JSON.stringify({ message: "Missing required fields: title, description, userId, status" }) };
        }

        console.log("Valid request. Preparing to insert into DynamoDB...");

        // Ensure TABLE_NAME is set correctly
        if (!TABLE_NAME) {
            return { statusCode: 500, body: JSON.stringify({ message: "DynamoDB table name is missing in environment variables" }) };
        }

        // Construct item for DynamoDB
        const timestamp = new Date().toISOString();
        const item = {
            PK: `CARD#${id}`,
            SK: "METADATA",
            GSI1PK: `STATUS#${status}`,
            GSI1SK: `CARD#${id}`,
            GSI2PK: `USER#${userId}`,
            GSI2SK: `CREATED_AT#${timestamp}`,
            title,
            description,
            userId,
            status,
            createdAt: timestamp,
        };

        // ✅ Only add paymentType if it's provided
        if (paymentType) {
            item.paymentType = paymentType;
        }

        console.log("DynamoDB Item to Insert:", JSON.stringify(item, null, 2));

        // Insert into DynamoDB
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
            MessageBody: JSON.stringify({ id, title, userId, status }),
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
