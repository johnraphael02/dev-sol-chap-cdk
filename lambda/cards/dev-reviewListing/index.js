const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda(); // For invoking the encryption function

// Use the existing "Listings" table
const TABLE_NAME = process.env.TABLE_NAME;
const QUEUE_URL = process.env.REVIEW_QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";
const ENCRYPTION_FUNCTION_NAME = "sol-chap-encryption"; // Encryption Lambda name

exports.handler = async (event) => {
    try {
        console.log("Received event:", JSON.stringify(event, null, 2));

        // Parse request body safely
        let body;
        try {
            body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
        } catch (parseError) {
            console.error("JSON Parse Error:", parseError);
            return { statusCode: 400, body: JSON.stringify({ message: "Invalid JSON format" }) };
        }

        console.log("Parsed request body:", body);

        // Extract fields
        const { id, status, adminId, notes } = body;

        if (!id || !status || !adminId) {
            console.error("Error: Missing required fields.");
            return { statusCode: 400, body: JSON.stringify({ message: "Missing required fields: id, status, adminId" }) };
        }

        // Allowed status values (adjust as needed)
        const allowedStatuses = ["approved", "rejected", "pending"];
        if (!allowedStatuses.includes(status.toLowerCase())) {
            console.error("Error: Invalid status value.");
            return { statusCode: 400, body: JSON.stringify({ message: `Invalid status: ${status}. Allowed values: ${allowedStatuses.join(", ")}` }) };
        }

        console.log("Valid request. Invoking encryption function...");

        // Invoke the encryption function to encrypt the fields (including id)
        const encryptionParams = {
            FunctionName: ENCRYPTION_FUNCTION_NAME,
            InvocationType: "RequestResponse",
            Payload: JSON.stringify({
                id,
                status,
                adminId,
                notes: notes || ""
            }),
        };

        const encryptionResponse = await lambda.invoke(encryptionParams).promise();
        const encryptionPayload = JSON.parse(encryptionResponse.Payload);

        if (encryptionResponse.FunctionError) {
            console.error("Encryption function error:", encryptionPayload);
            return { statusCode: 500, body: JSON.stringify({ message: "Encryption function failed", error: encryptionPayload }) };
        }

        // The encryption function returns a JSON with "encryptedData"
        const encryptedResult = JSON.parse(encryptionPayload.body);
        const encryptedData = encryptedResult.encryptedData;
        // Expecting encryptedData to have: id, status, adminId, and notes

        const reviewedAt = new Date().toISOString();

        // Update item in DynamoDB using encrypted values (including encrypted id in the partition key)
        const updateParams = {
            TableName: TABLE_NAME,
            Key: { PK: `LISTING#${encryptedData.id}`, SK: "STATUS" },
            UpdateExpression: "SET #status = :status, reviewedBy = :adminId, reviewedAt = :reviewedAt, notes = :notes",
            ExpressionAttributeNames: {
                "#status": "status" // Alias for reserved keyword
            },
            ExpressionAttributeValues: {
                ":status": encryptedData.status,
                ":adminId": encryptedData.adminId,
                ":reviewedAt": reviewedAt,
                ":notes": encryptedData.notes
            }
        };

        try {
            await dynamoDB.update(updateParams).promise();
            console.log("DynamoDB Updated Successfully");
        } catch (dbError) {
            console.error("DynamoDB Update Failed:", JSON.stringify(dbError, null, 2));
            return {
                statusCode: 500,
                body: JSON.stringify({ message: "DynamoDB Update Failed", error: dbError.message }),
            };
        }

        // Send Message to SQS if Queue URL is set
        if (QUEUE_URL) {
            try {
                console.log("Attempting to send message to SQS...");
                await sqs.sendMessage({
                    QueueUrl: QUEUE_URL,
                    MessageBody: JSON.stringify({
                        id: encryptedData.id,
                        status: encryptedData.status,
                        action: "review"
                    }),
                }).promise();
                console.log("SQS Message Sent:", encryptedData.id);
            } catch (sqsError) {
                console.error("SQS Message Send Failed:", JSON.stringify(sqsError, null, 2));
            }
        }

        // Trigger EventBridge Event
        try {
            console.log("Attempting to send event to EventBridge...");
            await eventBridge.putEvents({
                Entries: [
                    {
                        Source: "listing.service",
                        DetailType: "ReviewEvent",
                        Detail: JSON.stringify({
                            id: encryptedData.id,
                            status: encryptedData.status
                        }),
                        EventBusName: EVENT_BUS_NAME,
                    },
                ],
            }).promise();
            console.log("EventBridge Triggered:", encryptedData.id);
        } catch (eventError) {
            console.error("EventBridge Event Failed:", JSON.stringify(eventError, null, 2));
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Review recorded", id: encryptedData.id, status: encryptedData.status }),
        };
    } catch (error) {
        console.error("Unexpected Error:", JSON.stringify(error, null, 2));
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};
