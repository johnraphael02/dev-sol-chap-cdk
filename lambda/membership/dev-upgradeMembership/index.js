const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

// Use environment variable for encryption function name (default to "aes-encryption")
const encryptionFunction = process.env.ENCRYPTION_FUNCTION || "sol-chap-encryption";
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

        const { userId, membershipTier, email } = body;

        if (!userId || !membershipTier || !email) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields (userId, membershipTier, email)" }) };
        }

        const timestamp = new Date().toISOString();

        // Invoke the encryption Lambda to encrypt userId, membershipTier, email, and SK
        const encryptionResponse = await lambda.invoke({
            FunctionName: encryptionFunction,
            InvocationType: "RequestResponse",
            Payload: JSON.stringify({
                data: { 
                    userId, 
                    membershipTier, 
                    email, 
                    SK: "MEMBERSHIP" // Include SK in the encryption request
                }
            })
        }).promise();

        console.log("Encryption Lambda response:", encryptionResponse);

        const encryptionResult = JSON.parse(encryptionResponse.Payload);
        console.log("Parsed encryption result:", encryptionResult);

        const parsedEncryptionBody = JSON.parse(encryptionResult.body);
        const encryptedData = parsedEncryptionBody.encryptedData;

        if (!encryptedData || !encryptedData.userId || !encryptedData.membershipTier || !encryptedData.email || !encryptedData.SK) {
            throw new Error("Encryption failed: missing encrypted data");
        }

        // Store Membership Upgrade in DynamoDB
        try {
            console.log("Storing membership upgrade in DynamoDB...");
            await dynamoDB.put({
                TableName: USERS_TABLE,
                Item: {
                    PK: `USER#${encryptedData.userId}`,
                    SK: encryptedData.SK, // Encrypted SK
                    membershipTier: encryptedData.membershipTier,
                    createdAt: timestamp,
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

        // Send Membership Update to SQS Queue (if configured)
        if (MEMBERSHIP_QUEUE_URL) {
            try {
                console.log("Sending membership update to SQS...");
                await sqs.sendMessage({
                    QueueUrl: MEMBERSHIP_QUEUE_URL,
                    MessageBody: JSON.stringify({
                        userId: encryptedData.userId,
                        membershipTier: encryptedData.membershipTier,
                        timestamp
                    })
                }).promise();
                console.log("Membership update sent to SQS");
            } catch (sqsError) {
                console.error("SQS Error:", sqsError);
                return { statusCode: 500, body: JSON.stringify({ error: "SQS Send Failed" }) };
            }
        } else {
            console.warn("MEMBERSHIP_QUEUE_URL not configured");
        }

        // Publish EventBridge event for the membership upgrade
        try {
            console.log("Triggering EventBridge...");
            await eventBridge.putEvents({
                Entries: [{
                    Source: "aws.membership",
                    DetailType: "UpgradeMembership",
                    Detail: JSON.stringify({
                        userId: encryptedData.userId,
                        membershipTier: encryptedData.membershipTier,
                        timestamp
                    }),
                    EventBusName: "default",
                }],
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
