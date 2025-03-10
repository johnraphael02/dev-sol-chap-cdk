const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

const TABLE_NAME = process.env.TABLE_NAME || "Dev-Sections"; 
const QUEUE_URL = process.env.QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;
const ENCRYPTION_LAMBDA = "sol-chap-encryption";

// Validate environment variables
if (!TABLE_NAME || !QUEUE_URL || !EVENT_BUS_NAME || !ENCRYPTION_LAMBDA) {
    console.error("Missing required environment variables.");
    throw new Error("Server misconfiguration: missing environment variables");
}

exports.handler = async (event) => {
    console.log("Received event:", JSON.stringify(event, null, 2));

    try {
        if (!event.body) {
            return { statusCode: 400, body: JSON.stringify({ message: "Request body is required" }) };
        }

        let body;
        try {
            body = JSON.parse(event.body);
        } catch (error) {
            console.error("Invalid JSON format:", error);
            return { statusCode: 400, body: JSON.stringify({ message: "Invalid JSON format" }) };
        }

        // Validate required fields
        if (!body.sectionId || !body.name || !body.description || !body.status || !body.order || !body.metadata) {
            return { statusCode: 400, body: JSON.stringify({ message: "Missing required fields: sectionId, name, description, status, order, metadata" }) };
        }

        if (!["ACTIVE", "INACTIVE"].includes(body.status)) {
            return { statusCode: 400, body: JSON.stringify({ message: "Invalid status. Must be 'ACTIVE' or 'INACTIVE'" }) };
        }

        if (typeof body.order !== "number") {
            return { statusCode: 400, body: JSON.stringify({ message: "Invalid order. Must be a number." }) };
        }

        // Encrypt all fields including PK and SK (except timestamps)
        const encryptedValues = await encryptObject({
            PK: `SECTION#${body.sectionId}`,
            SK: "ORGANIZATION",
            sectionId: body.sectionId,
            name: body.name,
            description: body.description,
            status: body.status,
            order: body.order,
            parentId: body.parentId || null,
            metadata: JSON.stringify(body.metadata)
        });

        if (!encryptedValues) {
            throw new Error("Encryption failed for one or more fields");
        }

        const timestamp = new Date().toISOString(); // Corrected timestamp format
        const item = {
            PK: encryptedValues.PK,
            SK: encryptedValues.SK,
            sectionId: encryptedValues.sectionId,
            name: encryptedValues.name,
            description: encryptedValues.description,
            status: encryptedValues.status,
            order: encryptedValues.order,
            parentId: encryptedValues.parentId,
            metadata: encryptedValues.metadata,
            createdAt: timestamp,
            updatedAt: timestamp,
        };

        // Prepare SQS message
        const sqsMessage = {
            MessageBody: JSON.stringify({ 
                action: "section_organize", 
                sectionId: encryptedValues.sectionId,
                name: encryptedValues.name,
                status: encryptedValues.status
            }),
            QueueUrl: QUEUE_URL,
        };

        // Save to DynamoDB, send SQS message, and trigger EventBridge in parallel
        await Promise.all([
            dynamoDB.put({ TableName: TABLE_NAME, Item: item }).promise(),
            sqs.sendMessage(sqsMessage).promise(),
            eventBridge.putEvents({
                Entries: [
                    {
                        Source: "section.organizer",
                        DetailType: "SectionUpdated",
                        Detail: JSON.stringify({
                            sectionId: encryptedValues.sectionId,
                            status: encryptedValues.status
                        }),
                        EventBusName: EVENT_BUS_NAME
                    }
                ]
            }).promise()
        ]);

        console.log("Operations completed successfully");

        return { statusCode: 200, body: JSON.stringify({ message: "Section organized successfully", item }) };
    } catch (error) {
        console.error("Error organizing section:", error);
        return { statusCode: 500, body: JSON.stringify({ message: "Internal Server Error", error: error.message }) };
    }
};


// Helper function to encrypt multiple fields using Lambda
async function encryptObject(obj) {
    try {
        const encryptionPayload = {
            FunctionName: ENCRYPTION_LAMBDA,
            InvocationType: "RequestResponse",
            Payload: JSON.stringify({ body: JSON.stringify(obj) }),
        };

        const encryptionResponse = await lambda.invoke(encryptionPayload).promise();
        console.log("🔹 Full Encryption Lambda Response:", encryptionResponse);

        if (!encryptionResponse.Payload) {
            throw new Error("Encryption Lambda did not return any payload.");
        }

        let encryptedData;
        try {
            encryptedData = JSON.parse(encryptionResponse.Payload);
        } catch (parseError) {
            throw new Error("Failed to parse Encryption Lambda response.");
        }

        console.log("Parsed Encryption Response:", encryptedData);

        if (encryptedData.statusCode >= 400) {
            throw new Error("Encryption Lambda returned an error status.");
        }

        const parsedBody = JSON.parse(encryptedData.body);
        if (!parsedBody.encryptedData) {
            throw new Error("Encryption Lambda response is missing 'encryptedData'.");
        }

        return parsedBody.encryptedData;
    } catch (error) {
        console.error("Encryption error:", error);
        throw error;
    }
}