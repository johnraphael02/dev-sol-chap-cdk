const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

const MESSAGE_FILTERS_TABLE = process.env.MESSAGE_FILTERS_TABLE || "Dev-MessageFilters";
const QUEUE_URL = process.env.QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";
const ENCRYPTION_FUNCTION = "sol-chap-encryption"; // Encryption Lambda function

/**
 * Calls the encryption Lambda function
 */
async function encryptData(data) {
    const params = {
        FunctionName: ENCRYPTION_FUNCTION,
        Payload: JSON.stringify({ data }),
    };
    const response = await lambda.invoke(params).promise();
    const encryptedData = JSON.parse(response.Payload);
    return encryptedData.encrypted;
}

exports.handler = async (event) => {
    try {
        console.log("Received event:", JSON.stringify(event, null, 2));

        let requestBody;
        try {
            requestBody = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
        } catch (parseError) {
            console.error("JSON Parse Error:", parseError);
            return { statusCode: 400, body: JSON.stringify({ message: "Invalid JSON format" }) };
        }

        console.log("Parsed request body:", requestBody);

        const { filterId, name, pattern, action, enabled, metadata } = requestBody;

        if (!filterId || !name || !pattern || !action || enabled === undefined || !metadata) {
            console.error("Error: Missing required fields.");
            return { statusCode: 400, body: JSON.stringify({ message: "Missing required fields: filterId, name, pattern, action, enabled, metadata" }) };
        }

        console.log("Encrypting all data...");
        const encryptedFilterId = await encryptData(filterId);
        const encryptedName = await encryptData(name);
        const encryptedPattern = await encryptData(pattern);
        const encryptedAction = await encryptData(action);
        const encryptedEnabled = await encryptData(enabled.toString());
        const encryptedMetadata = await encryptData(JSON.stringify(metadata));
        const encryptedPK = await encryptData(`FILTER#${filterId}`);
        const encryptedSK = await encryptData("METADATA");

        const createdAt = new Date().getTime();
        const updatedAt = new Date().getTime();

        const updatedFilter = {
            PK: encryptedPK,
            SK: encryptedSK,
            filterId: encryptedFilterId,
            name: encryptedName,
            pattern: encryptedPattern,
            action: encryptedAction,
            enabled: encryptedEnabled,
            createdAt,
            updatedAt,
            metadata: encryptedMetadata,
        };

        console.log("DynamoDB Item to Insert:", JSON.stringify(updatedFilter, null, 2));

        try {
            await dynamoDB.put({ TableName: MESSAGE_FILTERS_TABLE, Item: updatedFilter }).promise();
            console.log("DynamoDB Inserted Successfully");
        } catch (dbError) {
            console.error("DynamoDB Insert Failed:", JSON.stringify(dbError, null, 2));
            return {
                statusCode: 500,
                body: JSON.stringify({ message: "DynamoDB Insert Failed", error: dbError.message }),
            };
        }

        if (QUEUE_URL) {
            try {
                console.log("Sending message to SQS...");
                await sqs.sendMessage({
                    QueueUrl: QUEUE_URL,
                    MessageBody: JSON.stringify({
                        eventType: "UPDATE_MESSAGE_FILTER",
                        filterId: encryptedFilterId,
                        filterData: updatedFilter,
                    }),
                }).promise();
                console.log("SQS Message Sent");
            } catch (sqsError) {
                console.error("SQS Message Send Failed:", JSON.stringify(sqsError, null, 2));
            }
        }

        try {
            console.log("Sending event to EventBridge...");
            await eventBridge.putEvents({
                Entries: [
                    {
                        EventBusName: EVENT_BUS_NAME,
                        Source: "custom.filter.service",
                        DetailType: "MessageFilterUpdated",
                        Detail: JSON.stringify({
                            filterId: encryptedFilterId,
                            filterData: updatedFilter,
                        }),
                    },
                ],
            }).promise();
            console.log("EventBridge Triggered");
        } catch (eventError) {
            console.error("EventBridge Event Failed:", JSON.stringify(eventError, null, 2));
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Filter updated successfully",
                filterId: encryptedFilterId,
            }),
        };
    } catch (error) {
        console.error("Unexpected Error:", JSON.stringify(error, null, 2));
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};
