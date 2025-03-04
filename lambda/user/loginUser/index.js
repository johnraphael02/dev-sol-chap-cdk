const AWS = require("aws-sdk");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid"); // Generates unique session IDs

const docClient = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event) => {
    const { email, password } = JSON.parse(event.body);

    if (!email || !password) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "Email and password are required." }),
        };
    }

    // Query the Users table using EmailIndex
    const params = {
        TableName: "Users",
        IndexName: "EmailIndex",
        KeyConditionExpression: "GSI1PK = :email AND begins_with(GSI1SK, :userPrefix)",
        ExpressionAttributeValues: {
            ":email": `EMAIL#${email}`,
            ":userPrefix": "USER#",
        },
    };

    try {
        const data = await docClient.query(params).promise();

        if (data.Items.length === 0) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: "User not found." }),
            };
        }

        const user = data.Items[0];

        // Compare passwords
        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            return {
                statusCode: 401,
                body: JSON.stringify({ message: "Invalid credentials." }),
            };
        }

        // ✅ Generate session data
        const sessionId = uuidv4();
        const timestamp = new Date().toISOString();

        // ✅ Step 1: Fetch all SK values related to the user
        const getAllSKParams = {
            TableName: "Users",
            KeyConditionExpression: "PK = :userPK",
            ExpressionAttributeValues: {
                ":userPK": user.PK, // USER#2468
            },
        };

        const allSKItems = await docClient.query(getAllSKParams).promise();

        if (allSKItems.Items.length === 0) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: "No user session data found." }),
            };
        }

        // ✅ Step 2: Update all existing SK rows to set event to LOGIN
        const updatePromises = allSKItems.Items.map(async (item) => {
            const updateParams = {
                TableName: "Users",
                Key: {
                    PK: user.PK,
                    SK: item.SK,
                },
                UpdateExpression: "SET #event = :login, session_id = :session, session_created_at = :timestamp",
                ExpressionAttributeNames: { "#event": "event" },
                ExpressionAttributeValues: {
                    ":login": "LOGIN",
                    ":session": sessionId,
                    ":timestamp": timestamp,
                },
            };

            return docClient.update(updateParams).promise();
        });

        await Promise.all(updatePromises);

        // ✅ Respond with success
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "User authenticated successfully.",
                user_id: user.PK,
                session: sessionId, // Return the session ID
            }),
        };
    } catch (error) {
        console.error("Error processing authentication", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Internal server error." }),
        };
    }
};
