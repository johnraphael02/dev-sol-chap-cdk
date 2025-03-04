const AWS = require('aws-sdk');

const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const encryptionFunction = "aes-encryption";

const tableName = process.env.MESSAGE_TABLE;  // DynamoDB Table
const FILTER_QUEUE_URL = process.env.FILTER_QUEUE_URL;  // SQS Queue

exports.handler = async (event) => {
    try {
        console.log("Received event:", JSON.stringify(event, null, 2));

        // Parse request body
        let body;
        try {
            body = JSON.parse(event.body);
        } catch (parseError) {
            console.error("Invalid JSON in request body:", parseError);
            return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON format" }) };
        }

        const { messageId, senderId, receiverId, messageText } = body;

        // Validate required fields
        if (!messageId || !messageText || !senderId || !receiverId) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields" }) };
        }

        const timestamp = new Date().toISOString();

        // Encrypt fields
        const encryptionResponse = await new AWS.Lambda().invoke({
            FunctionName: encryptionFunction,
            Payload: JSON.stringify({
                data: { messageId, senderId, receiverId, messageText }
            })
        }).promise();

        const encryptionResult = JSON.parse(encryptionResponse.Payload);
        const encryptedData = JSON.parse(encryptionResult.body).encryptedData?.data;

        if (!encryptedData) {
            throw new Error("Encryption failed");
        }

        // ✅ Contact Info Filter
        const contactPattern = /(email|phone|contact|@|\d{10,})/i;
        const containsContactInfo = contactPattern.test(messageText);

        if (containsContactInfo) {
            // ✅ Store in DynamoDB (Updated Schema)
            try {
                console.log("Storing flagged message in DynamoDB...");
                await dynamoDB.put({
                    TableName: tableName,
                    Item: {
                        PK: `MESSAGE#${encryptedData.messageId}`,         // Partition Key (Encrypted Message ID)
                        SK: `FILTER#${timestamp}`,          // Sort Key (FILTER + Timestamp)
                        GSI1PK: `STATUS#FLAGGED`,          // GSI for Status index (flagged status)
                        GSI1SK: `CREATED_AT#${timestamp}`, // GSI for timestamp sorting
                        GSI2PK: `USER#${encryptedData.senderId}`,        // GSI for User index (encrypted sender)
                        GSI2SK: `CREATED_AT#${timestamp}`, // GSI for timestamp sorting
                        senderId: encryptedData.senderId,
                        receiverId: encryptedData.receiverId,
                        messageText: encryptedData.messageText,
                        timestamp,
                        status: "FLAGGED"
                    }
                }).promise();
                console.log("Message stored in DynamoDB");
            } catch (dbError) {
                console.error("DynamoDB Error:", dbError);
                return { statusCode: 500, body: JSON.stringify({ error: "DynamoDB Write Failed" }) };
            }

            // ✅ Send to SQS Queue
            if (FILTER_QUEUE_URL) {
                try {
                    console.log("Sending flagged message to SQS...");
                    await sqs.sendMessage({
                        MessageBody: JSON.stringify({ messageId: encryptedData.messageId, senderId: encryptedData.senderId, receiverId: encryptedData.receiverId, messageText: encryptedData.messageText, timestamp }),
                        QueueUrl: FILTER_QUEUE_URL,
                    }).promise();
                    console.log("Message sent to SQS");
                } catch (sqsError) {
                    console.error("SQS Error:", sqsError);
                    return { statusCode: 500, body: JSON.stringify({ error: "SQS Send Failed" }) };
                }
            } else {
                console.warn("SQS Queue URL not configured.");
            }

            // ✅ Trigger EventBridge
            try {
                console.log("Triggering EventBridge...");
                await eventBridge.putEvents({
                    Entries: [
                        {
                            Source: "aws.messages",
                            DetailType: "FilterContactInfo",
                            Detail: JSON.stringify({ messageId: encryptedData.messageId, senderId: encryptedData.senderId, receiverId: encryptedData.receiverId, messageText: encryptedData.messageText, timestamp }),
                            EventBusName: "default",
                        },
                    ],
                }).promise();
                console.log("Event sent to EventBridge");
            } catch (eventBridgeError) {
                console.error("EventBridge Error:", eventBridgeError);
                return { statusCode: 500, body: JSON.stringify({ error: "EventBridge Trigger Failed" }) };
            }
        }

        return { statusCode: 201, body: JSON.stringify({ message: "Message processed successfully" }) };
    } catch (error) {
        console.error("Lambda Error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};