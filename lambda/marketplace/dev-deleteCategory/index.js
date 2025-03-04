const AWS = require("aws-sdk");
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const eventBridge = new AWS.EventBridge();
const sqs = new AWS.SQS();
const lambda = new AWS.Lambda();

const tableName = process.env.TABLE_NAME;
const DELETE_CATEGORY_QUEUE_URL = process.env.DELETE_CATEGORY_QUEUE_URL;

exports.handler = async (event) => {
    try {
        const encryptedCategoryId = event.pathParameters.id;

        if (!encryptedCategoryId) {
            return { statusCode: 400, body: JSON.stringify({ message: "Missing categoryId" }) };
        }

        console.log(`🔐 Encrypted Category ID: ${encryptedCategoryId}`);

        // Step 1: Call the AES Decryption Lambda function
        const lambdaParams = {
            FunctionName: "aes-decryption",
            Payload: JSON.stringify({ encryptedText: encryptedCategoryId }),
        };
        const lambdaResponse = await lambda.invoke(lambdaParams).promise();
        const decryptedData = JSON.parse(lambdaResponse.Payload);

        if (!decryptedData || !decryptedData.decryptedText) {
            return { statusCode: 500, body: JSON.stringify({ message: "Decryption failed" }) };
        }

        const categoryId = decryptedData.decryptedText;
        console.log(`✅ Decrypted Category ID: ${categoryId}`);

        // Step 2: Retrieve category details from DynamoDB
        const getParams = {
            TableName: tableName,
            KeyConditionExpression: "PK = :pk",
            ExpressionAttributeValues: { ":pk": `CATEGORY#${categoryId}` },
        };
        const result = await dynamoDB.query(getParams).promise();

        if (!result.Items || result.Items.length === 0) {
            return { statusCode: 404, body: JSON.stringify({ message: "Category not found" }) };
        }

        // Step 3: Extract correct SK from the query result
        const categoryItem = result.Items[0];
        const categorySK = categoryItem.SK;

        // Step 4: Delete the category using the decrypted ID
        const deleteParams = {
            TableName: tableName,
            Key: { PK: `CATEGORY#${categoryId}`, SK: categorySK },
        };
        await dynamoDB.delete(deleteParams).promise();
        console.log(`🗑️ Deleted category: ${categoryId}`);

        // Step 5: Publish an event to EventBridge
        const eventParams = {
            Entries: [
                {
                    Source: "aws.marketplace",
                    DetailType: "CategoryDeleted",
                    Detail: JSON.stringify({ categoryId }),
                    EventBusName: "default",
                },
            ],
        };
        await eventBridge.putEvents(eventParams).promise();
        console.log(`📢 EventBridge event published: CategoryDeleted ${categoryId}`);

        // Step 6: Send a message to the SQS queue
        const sqsParams = {
            QueueUrl: DELETE_CATEGORY_QUEUE_URL,
            MessageBody: JSON.stringify({ categoryId, action: "deleteCategory" }),
        };
        await sqs.sendMessage(sqsParams).promise();
        console.log(`📩 SQS message sent for deleted category: ${categoryId}`);

        return { statusCode: 200, body: JSON.stringify({ message: "Category deleted successfully" }) };
    } catch (error) {
        console.error("❌ Error deleting category:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};