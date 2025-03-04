const AWS = require("aws-sdk");

// Initialize AWS Services
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const eventBridge = new AWS.EventBridge();
const sqs = new AWS.SQS();

// Environment Variables
const USERS_TABLE = process.env.USERS_TABLE;
const PROFILE_QUEUE_URL = process.env.profileQueue;

exports.handler = async (event) => {
    console.log("Received Event:", JSON.stringify(event, null, 2));

    // Extract user ID from path parameters
    const userId = event.pathParameters.id;
    if (!userId) {
        return createResponse(400, { error: "User ID is required" });
    }

    // DynamoDB Query Params
    const params = {
        TableName: USERS_TABLE,
        Key: {
            PK: `USER#${userId}`,
            SK: "PROFILE",
        },
    };

    try {
        // Fetch user profile from DynamoDB
        const data = await dynamoDB.get(params).promise();
        if (!data.Item) {
            return createResponse(404, { error: "User profile not found" });
        }

        console.log("User Profile:", data.Item);

        // Send event to EventBridge
        await eventBridge.putEvents({
            Entries: [
                {
                    Source: "custom.user.profile",
                    DetailType: "Profile Read",
                    Detail: JSON.stringify({ userId }),
                    EventBusName: "default",
                },
            ],
        }).promise();

        // Send message to SQS
        await sqs.sendMessage({
            QueueUrl: PROFILE_QUEUE_URL,
            MessageBody: JSON.stringify({ action: "profileRead", userId }),
        }).promise();

        return createResponse(200, data.Item);

    } catch (error) {
        console.error("Error fetching user profile:", error);
        return createResponse(500, { error: "Internal Server Error" });
    }
};

// Helper Function for Responses
const createResponse = (statusCode, body) => ({
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
});

