const AWS = require("aws-sdk");
const dynamo = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

const encryptionFunction = "aes-encryption";
const LISTINGS_TABLE = process.env.LISTINGS_TABLE;
const VERIFY_QUEUE_URL = process.env.VERIFY_QUEUE_URL;
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
        } else {
            console.error("Unexpected event format:", event);
            return { statusCode: 400, body: JSON.stringify({ message: "Unexpected event format" }) };
        }

        for (const messageBody of messages) {
            const { listingId, userId, marketplaceId, categoryId, title, description, images = [], attributes = {}, price, creditType, visibility, tags = [], location, expiration } = messageBody;

            if (!listingId || !userId || !marketplaceId || !categoryId || !title || !price || !visibility) {
                console.error("Invalid message format:", messageBody);
                continue;
            }

            let encryptedData;
            try {
                const encryptionResponse = await lambda.invoke({
                    FunctionName: encryptionFunction,
                    Payload: JSON.stringify({
                        data: { listingId, userId, marketplaceId, categoryId, title, description, images, attributes, price, creditType, visibility, tags, location, expiration }
                    })
                }).promise();

                console.log("Encryption Lambda response:", encryptionResponse);
                const encryptionResult = JSON.parse(encryptionResponse.Payload);
                console.log("Parsed encryption result:", encryptionResult);

                const parsedBody = JSON.parse(encryptionResult.body);
                console.log("Parsed body from encryption result:", parsedBody);

                encryptedData = parsedBody.encryptedData?.data;

                if (!encryptedData || !encryptedData.listingId || !encryptedData.userId || !encryptedData.marketplaceId || !encryptedData.categoryId) {
                    throw new Error("Encryption failed: Missing encrypted fields");
                }
            } catch (encryptionError) {
                console.error("Encryption error:", encryptionError);
                return { statusCode: 500, body: JSON.stringify({ message: "Encryption failed" }) };
            }

            const timestamp = Date.now();
            const params = {
                TableName: LISTINGS_TABLE,
                Item: {
                    PK: `LISTING#${encryptedData.listingId}`,
                    SK: `USER#${encryptedData.userId}`,
                    GSI1PK: `MARKETPLACE#${encryptedData.marketplaceId}`,
                    GSI1SK: `STATUS#Pending#CREATED#${timestamp}`,
                    GSI2PK: `CATEGORY#${encryptedData.categoryId}`,
                    GSI2SK: `STATUS#Pending#PRICE#${encryptedData.price}`,
                    listingId: encryptedData.listingId,
                    userId: encryptedData.userId,
                    marketplaceId: encryptedData.marketplaceId,
                    categoryId: encryptedData.categoryId,
                    status: "Pending",
                    type: "General",
                    price: encryptedData.price,
                    creditType: encryptedData.creditType || "Cash",
                    content: {
                        title: encryptedData.title,
                        description: encryptedData.description || "",
                        images: encryptedData.images,
                        attributes: encryptedData.attributes,
                    },
                    metadata: {
                        visibility: encryptedData.visibility,
                        tags: encryptedData.tags,
                        location: encryptedData.location || null,
                        expiration: encryptedData.expiration || null,
                    },
                    stats: {
                        views: 0,
                        likes: 0,
                        shares: 0,
                        reports: 0,
                    },
                    moderation: {
                        status: "Pending",
                        reviewedBy: null,
                        reviewedAt: null,
                        notes: null,
                    },
                    createdAt: timestamp,
                    updatedAt: timestamp,
                },
            };

            await dynamo.put(params).promise();
            console.log(`Listing ${encryptedData.listingId} assigned to user ${encryptedData.userId} (Encrypted Data)`);

            await sqs.sendMessage({
                QueueUrl: VERIFY_QUEUE_URL,
                MessageBody: JSON.stringify({ listingId: encryptedData.listingId, title: encryptedData.title, categoryId: encryptedData.categoryId, price: encryptedData.price }),
            }).promise();

            await eventBridge.putEvents({
                Entries: [{
                    Source: "aws.marketplace",
                    DetailType: "VerifyListing",
                    Detail: JSON.stringify({ listingId: encryptedData.listingId, title: encryptedData.title, categoryId: encryptedData.categoryId, price: encryptedData.price }),
                    EventBusName: EVENT_BUS_NAME,
                }],
            }).promise();
        }

        return { statusCode: 200, body: JSON.stringify({ message: "Verification initiated with encryption" }) };
    } catch (error) {
        console.error("Error processing messages:", error);

        await eventBridge.putEvents({
            Entries: [{
                Source: "custom.listingHandler",
                EventBusName: EVENT_BUS_NAME,
                DetailType: "ProcessingError",
                Detail: JSON.stringify({ error: error.message, event }),
            }],
        }).promise();

        return { statusCode: 500, body: JSON.stringify({ message: "Internal Server Error" }) };
    }
};
