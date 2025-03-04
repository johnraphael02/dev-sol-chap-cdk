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
    throw new Error("Server misconfiguration: missing TABLE_NAME, QUEUE_URL, or EVENTBRIDGE_RULE");
}

exports.handler = async (event) => {
    console.log("Received event:", JSON.stringify(event, null, 2));

    try {
        if (!event.body) {
            return { statusCode: 400, body: JSON.stringify({ message: "Request body is required" }) };
        }

        let body;
        try {
            body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
        } catch (error) {
            console.error("Invalid JSON format:", error);
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Invalid JSON format" }),
            };
        }

        // Validate required fields
        if (!body.sectionId || !body.displayRules) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Missing sectionId or displayRules" }),
            };
        }

        const { sectionId, displayRules } = body;

        // Validate displayRules format
        if (typeof displayRules !== "object" || displayRules === null) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Invalid displayRules format. Must be an object." }),
            };
        }

        // Update the display rules in DynamoDB
        const params = {
            TableName: TABLE_NAME,
            Key: { PK: `SECTION#${sectionId}`, SK: "DISPLAY" },
            UpdateExpression: "SET displayRules = :rules",
            ExpressionAttributeValues: { ":rules": displayRules },
        };

        // Prepare SQS message
        const sqsMessage = {
            MessageBody: JSON.stringify({ sectionId, displayRules }),
            QueueUrl: QUEUE_URL,
        };

        // Save to DynamoDB, send SQS message, and trigger EventBridge in parallel
        await Promise.all([
            dynamoDB.update(params).promise(),
            sqs.sendMessage(sqsMessage).promise(),
            eventBridge.putEvents({
                Entries: [
                    {
                        Source: "display.rules.update",
                        DetailType: "DisplayRulesUpdated",
                        Detail: JSON.stringify({ sectionId, displayRules }),
                        EventBusName: EVENTBRIDGE_RULE
                    }
                ]
            }).promise()
        ]);

        console.log("Operations completed successfully");

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Display rules updated successfully" }),
        };

    } catch (error) {
        console.error("Error updating display rules:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error updating display rules", error: error.message }),
        };
    }
};
