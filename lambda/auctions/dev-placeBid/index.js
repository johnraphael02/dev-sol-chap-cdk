const AWS = require('aws-sdk');

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();
const encryptionFunction = "aes-encryption";

const BIDS_TABLE = process.env.BIDS_TABLE; // DynamoDB Table
const BID_QUEUE_URL = process.env.BID_QUEUE_URL; // SQS Queue

exports.handler = async (event) => {
    try {
        console.log("Received event:", JSON.stringify(event, null, 2));

        const auctionId = event.pathParameters.id;

        let body;
        try {
            body = JSON.parse(event.body);
        } catch (parseError) {
            console.error("Invalid JSON format:", parseError);
            return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON format" }) };
        }

        const { bidId, bidAmount, userId } = body;

        if (!bidId || !bidAmount || !auctionId || !userId) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields" }) };
        }

        const timestamp = new Date().toISOString();

        // Encrypt fields
        const encryptionResponse = await lambda.invoke({
            FunctionName: encryptionFunction,
            Payload: JSON.stringify({
                data: { bidId, auctionId, bidAmount, userId }
            })
        }).promise();

        const encryptionResult = JSON.parse(encryptionResponse.Payload);
        const encryptedData = JSON.parse(encryptionResult.body).encryptedData?.data;

        if (!encryptedData) {
            throw new Error("Encryption failed");
        }

        // Store Bid in DynamoDB
        try {
            console.log("Storing bid in DynamoDB...");
            await dynamoDB.put({
                TableName: BIDS_TABLE,
                Item: {
                    PK: `BID#${encryptedData.bidId}`,
                    SK: `AUCTION#${encryptedData.auctionId}`,
                    bid_data: {
                        bid_amount: encryptedData.bidAmount,
                        created_at: timestamp,
                    },
                    GSI1PK: `AUCTION#${encryptedData.auctionId}`,
                    GSI1SK: `TIMESTAMP#${timestamp}`,
                    GSI2PK: `USER#${encryptedData.userId}`,
                    GSI2SK: `TIMESTAMP#${timestamp}`,
                }
            }).promise();
            console.log("Bid stored in DynamoDB");
        } catch (dbError) {
            console.error("DynamoDB Error:", dbError);
            return { statusCode: 500, body: JSON.stringify({ error: "DynamoDB Write Failed" }) };
        }

        // Send Bid to SQS Queue
        if (BID_QUEUE_URL) {
            try {
                console.log("Sending bid to SQS...");
                await sqs.sendMessage({
                    MessageBody: JSON.stringify({
                        bidId: encryptedData.bidId,
                        auctionId: encryptedData.auctionId,
                        bidAmount: encryptedData.bidAmount,
                        userId: encryptedData.userId,
                        timestamp
                    }),
                    QueueUrl: BID_QUEUE_URL,
                }).promise();
                console.log("Bid sent to SQS");
            } catch (sqsError) {
                console.error("SQS Error:", sqsError);
                return { statusCode: 500, body: JSON.stringify({ error: "SQS Send Failed" }) };
            }
        } else {
            console.warn("SQS Queue URL not configured.");
        }

        // Trigger EventBridge
        try {
            console.log("Triggering EventBridge...");
            await eventBridge.putEvents({
                Entries: [
                    {
                        Source: "aws.auctions",
                        DetailType: "PlaceBid",
                        Detail: JSON.stringify({
                            bidId: encryptedData.bidId,
                            auctionId: encryptedData.auctionId,
                            bidAmount: encryptedData.bidAmount,
                            userId: encryptedData.userId,
                            timestamp
                        }),
                        EventBusName: "default",
                    },
                ],
            }).promise();
            console.log("Event sent to EventBridge");
        } catch (eventBridgeError) {
            console.error("EventBridge Error:", eventBridgeError);
            return { statusCode: 500, body: JSON.stringify({ error: "EventBridge Trigger Failed" }) };
        }

        return { statusCode: 201, body: JSON.stringify({ message: "Bid placed successfully" }) };
    } catch (error) {
        console.error("Lambda Error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
