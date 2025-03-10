const AWS = require("aws-sdk");
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

const TABLE_NAME = process.env.TABLE_NAME || "Dev-Cards";
const QUEUE_URL = process.env.UNCOVER_QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;
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

        const { userId, paymentType } = body;
        if (!userId || !paymentType) {
            return { statusCode: 400, body: JSON.stringify({ message: "Missing required fields: userId, paymentType." }) };
        }

        if (!["CHAPTER_COINS", "GOLD_COINS"].includes(paymentType)) {
            return { statusCode: 400, body: JSON.stringify({ message: "Invalid paymentType. Allowed values: CHAPTER_COINS, GOLD_COINS." }) };
        }

        console.log("Encrypting provided ID before lookup...");

        let encryptedId, encryptedSK, encryptedUserId, encryptedPaymentType;
        try {
            // Encrypt id and SK
            const encryptionResponse = await lambda.invoke({
                FunctionName: ENCRYPTION_LAMBDA,
                Payload: JSON.stringify({
                    body: JSON.stringify({ id, SK: "METADATA" })
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

            // Encrypt userId and paymentType
            console.log("Encrypting userId and paymentType...");
            const encryptionPayload = JSON.stringify({ userId, paymentType });
            const encryptionResponse2 = await lambda.invoke({
                FunctionName: ENCRYPTION_LAMBDA,
                Payload: JSON.stringify({ body: encryptionPayload })
            }).promise();

            const encryptionResult2 = JSON.parse(encryptionResponse2.Payload);
            if (encryptionResult2.statusCode !== 200) {
                throw new Error(`Encryption failed: ${encryptionResult2.body}`);
            }

            const parsedBody2 = JSON.parse(encryptionResult2.body);
            encryptedUserId = parsedBody2.encryptedData.userId;
            encryptedPaymentType = parsedBody2.encryptedData.paymentType;

            if (!encryptedUserId || !encryptedPaymentType) {
                throw new Error("Encryption failed: Missing encrypted userId or paymentType");
            }

        } catch (encryptionError) {
            console.error("Encryption error:", encryptionError);
            return { statusCode: 500, body: JSON.stringify({ message: "Encryption failed" }) };
        }

        console.log("Fetching encrypted ID from DynamoDB...");

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

        const timestamp = new Date().toISOString();
        const updateExpression = ["#updatedAt = :updatedAt"];
        const expressionAttributeNames = { "#updatedAt": "updatedAt" };
        const expressionAttributeValues = { ":updatedAt": timestamp };

        updateExpression.push("#paymentType = :paymentType", "#userId = :userId");
        expressionAttributeNames["#paymentType"] = "paymentType";
        expressionAttributeNames["#userId"] = "userId";
        expressionAttributeValues[":paymentType"] = encryptedPaymentType;
        expressionAttributeValues[":userId"] = encryptedUserId;

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

        const sqsMessage = {
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify({
                action: "CARD_UNCOVERED",
                cardId: encryptedId,
                userId: encryptedUserId,
                paymentType: encryptedPaymentType,
                uncoveredAt: timestamp,
            }),
        };
        await sqs.sendMessage(sqsMessage).promise();

        const eventBridgeParams = {
            Entries: [
                {
                    Source: "marketplace.card.uncover",
                    EventBusName: EVENT_BUS_NAME,
                    DetailType: "CardUncovered",
                    Detail: JSON.stringify({
                        cardId: encryptedId,
                        userId: encryptedUserId,
                        paymentType: encryptedPaymentType,
                        uncoveredAt: timestamp,
                    }),
                },
            ],
        };
        await eventBridge.putEvents(eventBridgeParams).promise();

        return { statusCode: 200, body: JSON.stringify({
            message: "Card uncovered successfully",
            cardId: encryptedId,
            userId: encryptedUserId,
            paymentType: encryptedPaymentType,
            uncoveredAt: timestamp,
        })};
    } catch (error) {
        console.error("Unexpected Error:", JSON.stringify(error, null, 2));
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};
