const AWS = require("aws-sdk");
const bcrypt = require("bcryptjs");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();

const USERS_TABLE = "Users";
const SQS_QUEUE_URL = "https://sqs.ap-southeast-2.amazonaws.com/066926217034/UserQueue";
const EMAIL_INDEX = "EmailIndex"; // GSI for email lookup

exports.handler = async (event) => {
    try {
        console.log("📌 Received register request:", event.body);

        const requestBody = JSON.parse(event.body);
        const { id, email, password, username, membershipTier } = requestBody;

        // 📌 Validate input
        if (!id || !email || !password || !username || !membershipTier) {
            console.warn("⚠️ Missing required fields:", requestBody);
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Missing required fields" }),
            };
        }

        // 📌 Check if user already exists by email using GSI (EmailIndex)
        const existingUser = await dynamoDB.query({
            TableName: USERS_TABLE,
            IndexName: EMAIL_INDEX,
            KeyConditionExpression: "GSI1PK = :emailKey",
            ExpressionAttributeValues: {
                ":emailKey": `EMAIL#${email}`,
            },
        }).promise();

        if (existingUser.Items.length > 0) {
            console.warn("⚠️ User with this email already exists:", email);
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Email already exists" }),
            };
        }

        // 📌 Hash the password before storing
        const hashedPassword = await bcrypt.hash(password, 10);

        // 📌 Store user in DynamoDB
        const newUser = {
            PK: `USER#${id}`,  // Partition Key
            SK: "METADATA",     // Sort Key
            GSI1PK: `EMAIL#${email}`, // Secondary Index for email lookup
            GSI1SK: `USER#${id}`,
            email,
            username,
            password: hashedPassword, // Store hashed password
            membershipTier,
            createdAt: new Date().toISOString(),
        };

        await dynamoDB.put({
            TableName: USERS_TABLE,
            Item: newUser,
        }).promise();

        console.log("✅ User registered successfully:", newUser);

        // 📌 Send a message to SQS for further processing (without password for security)
        const sqsMessage = {
            id,
            email,
            username,
            membershipTier,
            eventType: "UserCreateEvent",
        };

        await sqs.sendMessage({
            QueueUrl: SQS_QUEUE_URL,
            MessageBody: JSON.stringify(sqsMessage),
        }).promise();

        console.log("📨 User registration event sent to SQS:", sqsMessage);

        return {
            statusCode: 201,
            body: JSON.stringify({ message: "User registered successfully" }),
        };

    } catch (error) {
        console.error("❌ Error registering user:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Could not register user", details: error.message }),
        };
    }
};
