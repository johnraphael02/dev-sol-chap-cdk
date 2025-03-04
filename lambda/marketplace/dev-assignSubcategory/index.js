const AWS = require("aws-sdk");
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();
const eventBridge = new AWS.EventBridge();

const SECTIONS_TABLE = process.env.SECTIONS_TABLE;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || "default";

exports.handler = async (event) => {
    try {
        let messages = [];

        if (event.Records && Array.isArray(event.Records)) {
            for (const record of event.Records) {
                try {
                    messages.push(JSON.parse(record.body));
                } catch (parseError) {
                    console.error("Error parsing SQS message body:", record.body);
                }
            }
        } else if (event.body) {
            try {
                const parsedBody = JSON.parse(event.body);
                messages.push(parsedBody);
            } catch (parseError) {
                console.error("Error parsing API Gateway event body:", event.body);
                return { statusCode: 400, body: JSON.stringify({ message: "Invalid JSON format" }) };
            }
        } else if (event.sectionId && event.subcategoryId && event.name) {
            messages.push(event);
        } else {
            console.error("Unexpected event format:", event);
            return { statusCode: 400, body: JSON.stringify({ message: "Unexpected event format" }) };
        }

        for (const messageBody of messages) {
            const { sectionId, subcategoryId, name, displayRules, filters } = messageBody;
            if (!sectionId || !subcategoryId || !name) {
                console.error("Invalid message format:", messageBody);
                continue;
            }

            let encryptedData;
            try {
                const encryptionResponse = await lambda.invoke({
                    FunctionName: "aes-encryption",
                    Payload: JSON.stringify({
                        data: { sectionId, subcategoryId, name, displayRules, filters }
                    })
                }).promise();

                console.log("Encryption Lambda response:", encryptionResponse);
                const encryptionResult = JSON.parse(encryptionResponse.Payload);
                console.log("Parsed encryption result:", encryptionResult);

                const parsedBody = JSON.parse(encryptionResult.body);
                console.log("Parsed body from encryption result:", parsedBody);

                encryptedData = parsedBody.encryptedData?.data;

                if (!encryptedData || !encryptedData.sectionId || !encryptedData.subcategoryId || !encryptedData.name) {
                    throw new Error("Encryption failed: Missing encrypted fields");
                }
            } catch (encryptionError) {
                console.error("Encryption error:", encryptionError);
                return { statusCode: 500, body: JSON.stringify({ message: "Encryption failed" }) };
            }

            const params = {
                TableName: SECTIONS_TABLE,
                Item: {
                    PK: `SECTION#${encryptedData.sectionId}`,
                    SK: `SUBCATEGORY#${encryptedData.subcategoryId}`,
                    sectionId: encryptedData.sectionId,
                    subcategoryId: encryptedData.subcategoryId,
                    name: encryptedData.name,
                    displayRules: encryptedData.displayRules || {
                        layout: "GRID",
                        itemsPerPage: 20,
                        sortBy: "PRICE_DESC",
                    },
                    filters: encryptedData.filters || {
                        condition: ["NEW", "USED", "REFURBISHED"],
                        priceRange: { min: 100, max: 2000 },
                    },
                    GSI1PK: `SUBCATEGORY#${encryptedData.subcategoryId}`,
                    GSI1SK: `SECTION#${encryptedData.sectionId}`,
                    createdAt: new Date().toISOString(),
                },
            };

            await dynamoDB.put(params).promise();
            console.log(`Subcategory ${encryptedData.subcategoryId} assigned to section ${encryptedData.sectionId} (Encrypted Name)`);
        }

        return { statusCode: 200, body: JSON.stringify({ message: "Subcategory assigned successfully with encryption" }) };
    } catch (error) {
        console.error("Error processing messages:", error);

        await eventBridge.putEvents({
            Entries: [{
                Source: "custom.sqsHandler",
                EventBusName: EVENT_BUS_NAME,
                DetailType: "ProcessingError",
                Detail: JSON.stringify({ error: error.message, event }),
            }],
        }).promise();

        return { statusCode: 500, body: JSON.stringify({ message: "Internal Server Error" }) };
    }
};