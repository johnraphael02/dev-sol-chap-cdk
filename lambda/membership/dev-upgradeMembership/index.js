const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

// Environment variables
const encryptionFunction = process.env.ENCRYPTION_FUNCTION || "sol-chap-encryption";
const USERS_TABLE = process.env.USERS_TABLE;
const MEMBERSHIP_QUEUE_URL = process.env.MEMBERSHIP_QUEUE_URL;

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
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Missing required fields (userId, membershipLevel, email)" })
            };
        }

        const timestamp = new Date().toISOString();

        // 🔐 Invoke Encryption Lambda
        const encryptionResponse = await lambda.invoke({
            FunctionName: encryptionFunction,
            InvocationType: "RequestResponse",
            Payload: JSON.stringify({
                data: {
                    userId,
                    membershipLevel,
                    email,
                    PK: `USER#${userId}`,
                    SK: "MEMBERSHIP",
                    GSI1PK: `EMAIL#${email}`,
                    GSI1SK: `USER#${userId}`
                }
            }),
        }).promise();

        console.log("Encryption Lambda response:", encryptionResponse);

        const encryptionResult = JSON.parse(encryptionResponse.Payload);
        const parsedEncryptionBody = JSON.parse(encryptionResult.body);
        const encryptedData = parsedEncryptionBody.encryptedData?.data;

        if (!encryptedData || !encryptedData.userId || !encryptedData.membershipLevel || !encryptedData.email || !encryptedData.SK || !encryptedData.PK || !encryptedData.GSI1PK || !encryptedData.GSI1SK) {
            throw new Error("Encryption failed: missing encrypted data");
        }

        // ✅ Store Membership Upgrade in DynamoDB
        try {
            console.log("Storing membershipTier in DynamoDB...");
            await dynamoDB.put({
                TableName: USERS_TABLE,
                Item: {
                    PK: encryptedData.PK,
                    SK: encryptedData.SK,
                    membershipTier: encryptedData.membershipLevel, // ✅ renamed field here
                    createdAt: timestamp,
                    updatedAt: timestamp,
                    email: encryptedData.email,
                    GSI1PK: encryptedData.GSI1PK,
                    GSI1SK: encryptedData.GSI1SK
                },
                ConditionExpression: "attribute_not_exists(PK)",
            }).promise();
            console.log("MembershipTier stored in DynamoDB");
        } catch (dbError) {
            console.error("DynamoDB Error:", dbError);
            return { statusCode: 500, body: JSON.stringify({ error: "DynamoDB Write Failed" }) };
        }

        // ✅ Send to SQS
        if (MEMBERSHIP_QUEUE_URL) {
            try {
                console.log("Sending membershipTier update to SQS...");
                await sqs.sendMessage({
                    QueueUrl: MEMBERSHIP_QUEUE_URL,
                    MessageBody: JSON.stringify({
                        userId: encryptedData.userId,
                        membershipTier: encryptedData.membershipLevel, // ✅ renamed field here
                        timestamp,
                    }),
                }).promise();
                console.log("MembershipTier update sent to SQS");
            } catch (sqsError) {
                console.error("SQS Error:", sqsError);
                return { statusCode: 500, body: JSON.stringify({ error: "SQS Send Failed" }) };
            }
        } else {
            console.warn("MEMBERSHIP_QUEUE_URL not configured");
        }

        // ✅ EventBridge Notification
        try {
            console.log("Triggering EventBridge...");
            await eventBridge.putEvents({
                Entries: [{
                    Source: "aws.membership",
                    DetailType: "UpgradeMembership",
                    Detail: JSON.stringify({
                        userId: encryptedData.userId,
                        membershipTier: encryptedData.membershipLevel, // ✅ renamed field here
                        timestamp,
                    }),
                    EventBusName: "default",
                }],
            }).promise();
            console.log("Event sent to EventBridge");
        } catch (eventBridgeError) {
            console.error("EventBridge Error:", eventBridgeError);
            return { statusCode: 500, body: JSON.stringify({ error: "EventBridge Trigger Failed" }) };
        }

        return { statusCode: 201, body: JSON.stringify({ message: "MembershipTier upgraded successfully" }) };
    } catch (error) {
        console.error("Lambda Error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
