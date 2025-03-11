const AWS = require("aws-sdk");
const bcrypt = require("bcryptjs");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const lambda = new AWS.Lambda();

const USERS_TABLE = "Users";
const SQS_QUEUE_URL = "https://sqs.ap-southeast-2.amazonaws.com/066926217034/UserQueue";
const EMAIL_INDEX = "EmailIndex";
const ENCRYPTION_FUNCTION = process.env.ENCRYPTION_FUNCTION || "sol-chap-encryption";

exports.handler = async (event) => {
    try {
        console.log("📌 Received register request:", event.body);

        const requestBody = JSON.parse(event.body);
        const { id, email, password, username, membershipTier } = requestBody;

        if (!id || !email || !password || !username || !membershipTier) {
            console.warn("⚠️ Missing required fields:", requestBody);
            return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields" }) };
        }

        // Check if user already exists
        const existingUser = await dynamoDB.query({
            TableName: USERS_TABLE,
            IndexName: EMAIL_INDEX,
            KeyConditionExpression: "GSI1PK = :emailKey",
            ExpressionAttributeValues: { ":emailKey": `EMAIL#${email}` },
        }).promise();

        if (existingUser.Items.length > 0) {
            console.warn("⚠️ User with this email already exists:", email);
            return { statusCode: 400, body: JSON.stringify({ error: "Email already exists" }) };
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Encrypt user data
        const encryptionResponse = await lambda.invoke({
            FunctionName: ENCRYPTION_FUNCTION,
            InvocationType: "RequestResponse",
            Payload: JSON.stringify({
                data: {
                    id,
                    email,
                    username,
                    membershipTier,
                    SK: "METADATA"
                }
            })
        }).promise();

        console.log("🔒 Encryption Lambda response:", encryptionResponse);

        const encryptionResult = JSON.parse(encryptionResponse.Payload);
        const parsedEncryptionBody = JSON.parse(encryptionResult.body);
        const encryptedData = parsedEncryptionBody.encryptedData;

        if (!encryptedData || !encryptedData.id || !encryptedData.email || !encryptedData.username || !encryptedData.SK) {
            throw new Error("Encryption failed: missing encrypted data");
        }

        // Store encrypted user in DynamoDB
        const newUser = {
            PK: `USER#${encryptedData.id}`,
            SK: encryptedData.SK,
            GSI1PK: `EMAIL#${encryptedData.email}`,
            GSI1SK: `USER#${encryptedData.id}`,
            email: encryptedData.email,
            username: encryptedData.username,
            password: hashedPassword, // Keep password hashed
            membershipTier: encryptedData.membershipTier,
            createdAt: new Date().toISOString(),
        };

        await dynamoDB.put({ TableName: USERS_TABLE, Item: newUser }).promise();
        console.log("✅ User registered successfully:", newUser);

        // Send event to SQS (excluding password)
        const sqsMessage = {
            id: encryptedData.id,
            email: encryptedData.email,
            username: encryptedData.username,
            membershipTier: encryptedData.membershipTier,
            eventType: "UserCreateEvent",
        };

        await sqs.sendMessage({ QueueUrl: SQS_QUEUE_URL, MessageBody: JSON.stringify(sqsMessage) }).promise();
        console.log("📨 User registration event sent to SQS:", sqsMessage);

        return { statusCode: 201, body: JSON.stringify({ message: "User registered successfully" }) };
    } catch (error) {
        console.error("❌ Error registering user:", error);
        return { statusCode: 500, body: JSON.stringify({ error: "Could not register user", details: error.message }) };
    }
};
