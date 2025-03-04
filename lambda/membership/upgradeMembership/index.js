const AWS = require('aws-sdk');

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();
const encryptionFunction = "aes-encryption";

const USERS_TABLE = process.env.USERS_TABLE; // DynamoDB Users Table
const MEMBERSHIP_QUEUE_URL = process.env.MEMBERSHIP_QUEUE_URL; // SQS Queue

exports.handler = async (event) => {
    try {
        console.log("Received event:", JSON.stringify(event, null, 2));

        let body;
        try {
            body = JSON.parse(event.body);
        } catch (parseError) {
            console.error("Invalid JSON format:", parseError);
            return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON format" }) };
        }

        const { userId, membershipLevel, email } = body;

        if (!userId || !membershipLevel || !email) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields (userId, membershipLevel, email)" }) };
        }

        const timestamp = new Date().toISOString();

        // Encrypt fields
        const encryptionResponse = await lambda.invoke({
            FunctionName: encryptionFunction,
            Payload: JSON.stringify({
                data: { userId, membershipLevel, email }
            })
        }).promise();

        const encryptionResult = JSON.parse(encryptionResponse.Payload);
        const encryptedData = JSON.parse(encryptionResult.body).encryptedData?.data;

        if (!encryptedData) {
            throw new Error("Encryption failed");
        }

        // Store Membership Upgrade in DynamoDB
        try {
            console.log("Storing membership upgrade in DynamoDB...");
            await dynamoDB.put({
                TableName: USERS_TABLE,
                Item: {
                    PK: `USER#${encryptedData.userId}`,
                    SK: `MEMBERSHIP`,
                    membership_status: encryptedData.membershipLevel,
                    created_at: timestamp,
                    updated_at: timestamp,
                    email: encryptedData.email,
                    GSI1PK: `EMAIL#${encryptedData.email}`,
                    GSI1SK: `USER#${encryptedData.userId}`,
                },
                ConditionExpression: "attribute_not_exists(PK)",
            }).promise();
            console.log("Membership upgrade stored in DynamoDB");
        } catch (dbError) {
            console.error("DynamoDB Error:", dbError);
            return { statusCode: 500, body: JSON.stringify({ error: "DynamoDB Write Failed" }) };
        }

        // Send Membership Update to SQS Queue
        if (MEMBERSHIP_QUEUE_URL) {
            try {
                console.log("Sending membership update to SQS...");
                await sqs.sendMessage({
                    MessageBody: JSON.stringify({
                        userId: encryptedData.userId,
                        membershipLevel: encryptedData.membershipLevel,
                        timestamp
                    }),
                    QueueUrl: MEMBERSHIP_QUEUE_URL,
                }).promise();
                console.log("Membership update sent to SQS");
            } catch (sqsError) {
                console.error("SQS Error:", sqsError);
                return { statusCode: 500, body: JSON.stringify({ error: "SQS Send Failed" }) };
            }
        } else {
            console.warn("SQS Queue URL not configured.");
        }

        // Trigger EventBridge
        try {
            console.log("Triggering EventBridge...");
            await eventBridge.putEvents({
                Entries: [
                    {
                        Source: "aws.membership",
                        DetailType: "UpgradeMembership",
                        Detail: JSON.stringify({
                            userId: encryptedData.userId,
                            membershipLevel: encryptedData.membershipLevel,
                            timestamp
                        }),
                        EventBusName: "default",
                    },
                ],
            }).promise();
            console.log("Event sent to EventBridge");
        } catch (eventBridgeError) {
            console.error("EventBridge Error:", eventBridgeError);
            return { statusCode: 500, body: JSON.stringify({ error: "EventBridge Trigger Failed" }) };
        }

        return { statusCode: 201, body: JSON.stringify({ message: "Membership upgraded successfully" }) };
    } catch (error) {
        console.error("Lambda Error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};