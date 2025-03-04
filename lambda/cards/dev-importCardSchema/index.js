const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

const CARDSCHEMAS_TABLE = process.env.CARDSCHEMAS_TABLE;
const SCHEMA_IMPORT_QUEUE_URL = process.env.SCHEMA_IMPORT_QUEUE_URL;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;

exports.handler = async (event) => {
    try {
        console.log("Received event:", JSON.stringify(event, null, 2));

        if (!event.body) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Request body is missing' }) };
        }

        let requestBody;
        try {
            requestBody = JSON.parse(event.body);
        } catch (error) {
            console.error('Invalid JSON:', event.body);
            return { statusCode: 400, body: JSON.stringify({ message: 'Invalid JSON format' }) };
        }

        const { schemaId, sectionId, schemaName, attributes } = requestBody;
        if (!schemaId || !sectionId || !schemaName || !attributes || !Array.isArray(attributes)) {
            return { statusCode: 400, body: JSON.stringify({ message: 'schemaId, sectionId, schemaName, and attributes (array) are required' }) };
        }

        // Encrypt the data
        let encryptedData;
        try {
            const encryptionResponse = await lambda.invoke({
                FunctionName: "aes-encryption",
                Payload: JSON.stringify({ data: { schemaId, sectionId, schemaName, attributes } })
            }).promise();

            const encryptionResult = JSON.parse(encryptionResponse.Payload);
            const parsedBody = JSON.parse(encryptionResult.body);
            encryptedData = parsedBody.encryptedData?.data;

            if (!encryptedData || !encryptedData.schemaId || !encryptedData.sectionId || !encryptedData.schemaName) {
                throw new Error("Encryption failed: Missing encrypted fields");
            }
        } catch (encryptionError) {
            console.error("Encryption error:", encryptionError);
            return { statusCode: 500, body: JSON.stringify({ message: "Encryption failed" }) };
        }

        // Store encrypted data in DynamoDB
        const params = {
            TableName: CARDSCHEMAS_TABLE,
            Item: {
                PK: `SCHEMA#${encryptedData.schemaId}`,
                SK: `SECTION#${encryptedData.sectionId}`,
                schemaName: encryptedData.schemaName,
                attributes: encryptedData.attributes,
                createdAt: new Date().toISOString(),
                GSI1PK: `SECTION#${encryptedData.sectionId}`,
                GSI1SK: `SCHEMA#${encryptedData.schemaId}`,
            },
            ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        };
        await dynamoDB.put(params).promise();
        console.log("DynamoDB insert successful");

        // Send encrypted message to SQS
        await sqs.sendMessage({
            QueueUrl: SCHEMA_IMPORT_QUEUE_URL,
            MessageBody: JSON.stringify({
                schemaId: encryptedData.schemaId,
                sectionId: encryptedData.sectionId,
                schemaName: encryptedData.schemaName,
                attributes: encryptedData.attributes,
                eventType: "SCHEMA_IMPORTED",
            }),
        }).promise();
        console.log("Message sent to SQS");

        // Publish encrypted event to EventBridge
        await eventBridge.putEvents({
            Entries: [{
                EventBusName: EVENT_BUS_NAME,
                Source: "custom.cardSchemas",
                DetailType: "CardSchemaImported",
                Detail: JSON.stringify({
                    schemaId: encryptedData.schemaId,
                    sectionId: encryptedData.sectionId,
                    schemaName: encryptedData.schemaName,
                    attributes: encryptedData.attributes,
                }),
            }],
        }).promise();
        console.log("Event published to EventBridge");

        return { statusCode: 201, body: JSON.stringify({ message: 'Card schema imported successfully with encryption' }) };
    } catch (error) {
        console.error('Error importing card schema:', error);
        return { statusCode: 500, body: JSON.stringify({ message: 'Internal Server Error', error: error.message }) };
    }
};
