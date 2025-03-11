const AWS = require("aws-sdk");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();

const USERS_TABLE = "Dev-Users";
const SQS_QUEUE_URL = "https://sqs.ap-southeast-2.amazonaws.com/066926217034/Dev-UserQueue";
const EMAIL_INDEX = "Dev-EmailIndex";

// AES Encryption Configuration
const secret_key = process.env.AES_SECRET_KEY;
const secret_iv = process.env.AES_SECRET_IV;
const encryption_method = process.env.AES_ENCRYPTION_METHOD;

const key = crypto.createHash("sha512").update(secret_key).digest("hex").substring(0, 32);
const encryptionIV = crypto.createHash("sha512").update(secret_iv).digest("hex").substring(0, 16);

function encryptData(data) {
    const cipher = crypto.createCipheriv(encryption_method, key, encryptionIV);
    return Buffer.from(cipher.update(data, "utf8", "hex") + cipher.final("hex")).toString("base64");
}

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

        // 📌 Hash the password before encrypting
        const hashedPassword = await bcrypt.hash(password, 10);

        // 📌 Encrypt user data
        const encryptedUser = {
            PK: encryptData(`USER#${id}`),
            SK: encryptData("METADATA"),
            GSI1PK: encryptData(`EMAIL#${email}`),
            GSI1SK: encryptData(`USER#${id}`),
            email: encryptData(email),
            username: encryptData(username),
            password: encryptData(hashedPassword),
            membershipTier: encryptData(membershipTier),
            created_at: encryptData(new Date().toISOString()),
        };

        await dynamoDB.put({
            TableName: USERS_TABLE,
            Item: encryptedUser,
        }).promise();

        console.log("✅ User registered successfully:", encryptedUser);

        // 📌 Send a message to SQS for further processing (without password for security)
        const sqsMessage = {
            id: encryptData(id),
            email: encryptData(email),
            username: encryptData(username),
            membershipTier: encryptData(membershipTier),
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