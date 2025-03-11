const AWS = require("aws-sdk");
const bcrypt = require("bcryptjs");

// AWS Services
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const lambda = new AWS.Lambda();

// Environment Variables
const USERS_TABLE = "Dev-Users";
const SQS_QUEUE_URL = "https://sqs.ap-southeast-2.amazonaws.com/066926217034/Dev-UserQueue";
const EMAIL_INDEX = "Dev-EmailIndex"; // GSI for email lookup
const ENCRYPTION_LAMBDA = "sol-chap-encryption"; // Lambda function name

// Function to invoke encryption Lambda
const encryptField = async (fieldValue) => {
    const payload = JSON.stringify({ text: fieldValue });

    const response = await lambda.invoke({
        FunctionName: ENCRYPTION_LAMBDA,
        Payload: payload,
    }).promise();

    const encryptedData = JSON.parse(response.Payload);
    return encryptedData.encryptedText;
};

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

        // 📌 Encrypt all fields (including PK & SK)
        const encryptedId = await encryptField(id);
        const encryptedEmail = await encryptField(email);
        const encryptedUsername = await encryptField(username);
        const encryptedMembershipTier = await encryptField(membershipTier);
        
        // Hash and encrypt password
        const hashedPassword = await bcrypt.hash(password, 10);
        const encryptedPassword = await encryptField(hashedPassword);

        // Encrypt PK & SK
        const encryptedPK = await encryptField(`USER#${id}`);
        const encryptedSK = await encryptField("METADATA");

        // 📌 Check if encrypted user already exists (using encrypted email)
        const existingUser = await dynamoDB.query({
            TableName: USERS_TABLE,
            IndexName: EMAIL_INDEX,
            KeyConditionExpression: "GSI1PK = :emailKey",
            ExpressionAttributeValues: {
                ":emailKey": `EMAIL#${encryptedEmail}`,
            },
        }).promise();

        if (existingUser.Items.length > 0) {
            console.warn("⚠️ User with this email already exists:", email);
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Email already exists" }),
            };
        }

        // 📌 Store encrypted user data in DynamoDB
        const newUser = {
            PK: encryptedPK, // Encrypted Partition Key
            SK: encryptedSK, // Encrypted Sort Key
            GSI1PK: `EMAIL#${encryptedEmail}`, // Encrypted Email for lookup
            GSI1SK: encryptedPK, // Encrypted ID for lookup
            email: encryptedEmail,
            username: encryptedUsername,
            password: encryptedPassword,
            membershipTier: encryptedMembershipTier,
            created_at: new Date().toISOString(), // Timestamp remains unencrypted
        };

        await dynamoDB.put({
            TableName: USERS_TABLE,
            Item: newUser,
        }).promise();

        console.log("✅ User registered successfully (encrypted via Lambda):", newUser);

        // 📌 Send encrypted data to SQS
        const sqsMessage = {
            id: encryptedId,
            email: encryptedEmail,
            username: encryptedUsername,
            membershipTier: encryptedMembershipTier,
            eventType: "UserCreateEvent",
        };

        await sqs.sendMessage({
            QueueUrl: SQS_QUEUE_URL,
            MessageBody: JSON.stringify(sqsMessage),
        }).promise();

        console.log("📨 User registration event sent to SQS (encrypted via Lambda):", sqsMessage);

        return {
            statusCode: 201,
            body: JSON.stringify({ message: "User registered successfully (encrypted via Lambda)" }),
        };

    } catch (error) {
        console.error("❌ Error registering user:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Could not register user", details: error.message }),
        };
    }
};
