const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();

const TABLE_NAME = process.env.TABLE_NAME;
const QUEUE_URL = process.env.QUEUE_URL;
const COGNITO_POOL = process.env.COGNITO_POOL;
const EVENTBRIDGE_RULE = process.env.EVENTBRIDGE_RULE;

exports.handler = async (event) => {
    console.log("Received event:", JSON.stringify(event, null, 2));

    try {
        if (!event.body) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Request body is required" }),
            };
        }

        const body = JSON.parse(event.body);

        if (!body.subcategoryId || !body.categoryId || !body.name || body.displayOrder === undefined) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Missing required fields: subcategoryId, categoryId, name, displayOrder" }),
            };
        }

        const timestamp = new Date().toISOString();
        const item = {
            PK: `SUBCATEGORY#${body.subcategoryId}`,
            SK: `CATEGORY#${body.categoryId}`,
            GSI1PK: `CATEGORY#${body.categoryId}`,
            GSI1SK: `ORDER#${body.displayOrder}`,
            subcategory_data: {
                name: body.name,
                description: body.description || "",
                displayOrder: body.displayOrder,
                created_at: timestamp,
                updated_at: timestamp,
            },
        };

        await dynamoDB.put({ TableName: TABLE_NAME, Item: item }).promise();
        console.log("DynamoDB entry added:", item);

        const sqsMessage = {
            MessageBody: JSON.stringify({ 
                subcategoryId: body.subcategoryId, 
                categoryId: body.categoryId, 
                name: body.name,
                displayOrder: body.displayOrder
            }),
            QueueUrl: QUEUE_URL,
        };

        await sqs.sendMessage(sqsMessage).promise();
        console.log("SQS message sent:", sqsMessage);

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Subcategory created successfully", item }),
        };

    } catch (error) {
        console.error("Error creating subcategory:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Internal Server Error", error: error.message }),
        };
    }
};
