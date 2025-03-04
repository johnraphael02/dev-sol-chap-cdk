const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();

const TABLE_NAME = process.env.TABLE_NAME;
const QUEUE_URL = process.env.QUEUE_URL;
const EVENTBRIDGE_RULE = process.env.EVENTBRIDGE_RULE;

// Validate environment variables
if (!TABLE_NAME || !QUEUE_URL || !EVENTBRIDGE_RULE) {
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

        // Additional field validation
        if (!["ACTIVE", "INACTIVE"].includes(body.status)) {
            return { statusCode: 400, body: JSON.stringify({ message: "Invalid status. Must be 'ACTIVE' or 'INACTIVE'" }) };
        }

        if (typeof body.order !== "number") {
            return { statusCode: 400, body: JSON.stringify({ message: "Invalid order. Must be a number." }) };
        }

        const timestamp = Date.now();
        const item = {
            PK: `SECTION#${body.sectionId}`,
            SK: "ORGANIZATION",
            sectionId: body.sectionId,
            name: body.name,
            description: body.description,
            status: body.status,
            order: body.order,
            parentId: body.parentId || null,
            metadata: {
                icon: body.metadata.icon || "default-icon",
                color: body.metadata.color || "#000000",
                visibility: body.metadata.visibility || "PUBLIC",
                permissions: Array.isArray(body.metadata.permissions) ? body.metadata.permissions : [],
            },
            createdAt: timestamp,
            updatedAt: timestamp,
        };

        // Prepare SQS message
        const sqsMessage = {
            MessageBody: JSON.stringify({ 
                action: "section_organize", 
                sectionId: body.sectionId,
                name: body.name,
                status: body.status
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
                            sectionId: body.sectionId,
                            status: body.status
                        }),
                        EventBusName: EVENTBRIDGE_RULE
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
