const AWS = require("aws-sdk");
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda(); // Add Lambda service

const MESSAGE_FILTERS_TABLE = process.env.MESSAGE_FILTERS_TABLE;
const QUEUE_URL = process.env.QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";
const ENCRYPTION_FUNCTION_NAME = "sol-chap-encryption"; // Encryption Lambda Function Name

exports.handler = async (event) => {
    try {
        const requestBody = JSON.parse(event.body);
        const { filterId, name, pattern, action, enabled, metadata } = requestBody;

        // Validate input fields
        if (!filterId || !name || !pattern || !action || enabled === undefined || !metadata) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: "Missing required fields: filterId, name, pattern, action, enabled, metadata",
                }),
            };
        }

        // Encrypt sensitive data before storing
        const encryptionParams = {
            FunctionName: ENCRYPTION_FUNCTION_NAME,
            Payload: JSON.stringify({
                body: JSON.stringify({ name, pattern, action, metadata }),
            }),
        };

        const encryptionResponse = await lambda.invoke(encryptionParams).promise();
        const encryptionResponseParsed = JSON.parse(encryptionResponse.Payload);

        if (encryptionResponseParsed.statusCode >= 400) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: "Failed to encrypt filter data" }),
            };
        }

        const { name: encryptedName, pattern: encryptedPattern, action: encryptedAction, metadata: encryptedMetadata } =
            JSON.parse(encryptionResponseParsed.body).encryptedData;

        // Define the MessageFilter structure with encrypted fields
        const updatedFilter = {
            PK: `FILTER#${filterId}`,
            SK: "METADATA",
            filterId: filterId,
            name: encryptedName,
            pattern: encryptedPattern,
            action: encryptedAction,
            enabled: enabled,
            createdAt: new Date().getTime(),
            updatedAt: new Date().getTime(),
            metadata: encryptedMetadata,
        };

        // Store encrypted filter data in DynamoDB
        await dynamoDB.put({
            TableName: MESSAGE_FILTERS_TABLE,
            Item: updatedFilter,
        }).promise();

        // Send encrypted filter data to SQS Queue
        await sqs.sendMessage({
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify({
                eventType: "UPDATE_MESSAGE_FILTER",
                filterId: filterId,
                filterData: updatedFilter,
            }),
        }).promise();

        // Trigger an event in EventBridge
        await eventBridge.putEvents({
            Entries: [
                {
                    EventBusName: EVENT_BUS_NAME,
                    Source: "custom.filter.service",
                    DetailType: "MessageFilterUpdated",
                    Detail: JSON.stringify({
                        filterId: filterId,
                        filterData: updatedFilter,
                    }),
                },
            ],
        }).promise();

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Filter updated successfully with encrypted data",
                filterId: filterId,
            }),
        };
    } catch (error) {
        console.error("Error updating filter:", error);

        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Failed to update filter", error: error.message }),
        };
    }
};
