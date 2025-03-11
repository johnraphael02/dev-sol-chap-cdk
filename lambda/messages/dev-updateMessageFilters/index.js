const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();

const MESSAGE_FILTERS_TABLE = process.env.MESSAGE_FILTERS_TABLE;
const QUEUE_URL = process.env.QUEUE_URL; // SQS Queue URL
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default'; // EventBus Name

exports.handler = async (event) => {
    try {
        const requestBody = JSON.parse(event.body);
        const filterId = requestBody.filterId;
        const { name, pattern, action, enabled, metadata } = requestBody;

        // Validate input fields
        if (!filterId || !name || !pattern || !action || enabled === undefined || !metadata) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Missing required fields: filterId, name, pattern, action, enabled, metadata" }),
            };
        }

        // Define the MessageFilter structure
        const updatedFilter = {
            PK: `FILTER#${filterId}`,
            SK: 'METADATA',
            filterId: filterId,
            name: name,
            pattern: pattern,
            action: action,  // BLOCK, FLAG, or MODIFY
            enabled: enabled,
            createdAt: new Date().getTime(),
            updatedAt: new Date().getTime(),
            metadata: metadata
        };

        const params = {
            TableName: MESSAGE_FILTERS_TABLE,
            Item: updatedFilter,
        };

        // Update filter data in DynamoDB
        await dynamoDB.put(params).promise();

        // Send message to SQS Queue
        const sqsMessage = {
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify({
                eventType: "UPDATE_MESSAGE_FILTER",
                filterId: filterId,
                filterData: updatedFilter,
            }),
        };
        await sqs.sendMessage(sqsMessage).promise();

        // Trigger EventBridge Event
        const eventParams = {
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
        };
        await eventBridge.putEvents(eventParams).promise();

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Filter updated successfully",
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