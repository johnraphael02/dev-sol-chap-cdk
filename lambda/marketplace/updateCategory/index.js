const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS();
const eventBridge = new AWS.EventBridge();
const lambda = new AWS.Lambda();

const tableName = process.env.TABLE_NAME;
const queueUrl = process.env.CATEGORY_QUEUE_URL; // SQS Queue URL
const eventBusName = process.env.EVENT_BUS_NAME; // EventBridge Bus Name
const encryptionFunction = "aes-encryption"; // Replace with your actual Lambda function name

exports.handler = async (event) => {
  try {
    const categoryId = event.pathParameters.id;
    const requestBody = JSON.parse(event.body);

    if (!requestBody.marketplaceId || !requestBody.name) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Missing required fields: marketplaceId and name' }),
      };
    }

    const timestamp = new Date().toISOString();

    // 🔐 Step 1: Encrypt `name` and `description`
    const encryptionPayload = JSON.stringify({
      data: {
        name: requestBody.name,
        description: requestBody.description || '',
      },
    });

    const encryptionResponse = await lambda.invoke({
      FunctionName: encryptionFunction,
      Payload: encryptionPayload,
    }).promise();

    const encryptionResult = JSON.parse(encryptionResponse.Payload);
    const encryptedData = JSON.parse(encryptionResult.body).encryptedData?.data;

    if (!encryptedData) {
      throw new Error("Encryption failed");
    }

    // 🔐 Step 2: Use Encrypted Data in Update
    const params = {
      TableName: tableName,
      Key: {
        PK: `CATEGORY#${categoryId}`,
        SK: `MARKETPLACE#${requestBody.marketplaceId}`,
      },
      UpdateExpression: 'SET #name = :name, #description = :description, updated_at = :updated_at',
      ExpressionAttributeNames: {
        '#name': 'name',
        '#description': 'description',
      },
      ExpressionAttributeValues: {
        ':name': encryptedData.name, // Encrypted name
        ':description': encryptedData.description, // Encrypted description
        ':updated_at': timestamp,
      },
      ReturnValues: 'ALL_NEW',
    };

    const result = await dynamodb.update(params).promise();
    const updatedCategory = result.Attributes;

    // 🔐 Step 3: Send Encrypted Data to SQS
    const sqsMessage = {
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        eventType: 'CATEGORY_UPDATED',
        categoryId,
        marketplaceId: requestBody.marketplaceId,
        updatedCategory, // Contains encrypted data
      }),
    };
    await sqs.sendMessage(sqsMessage).promise();

    // 🔐 Step 4: Publish Encrypted Data to EventBridge
    const eventBridgeParams = {
      Entries: [
        {
          EventBusName: eventBusName,
          Source: 'custom.category.service',
          DetailType: 'CategoryUpdated',
          Detail: JSON.stringify({
            categoryId,
            marketplaceId: requestBody.marketplaceId,
            updatedCategory, // Contains encrypted data
          }),
        },
      ],
    };
    await eventBridge.putEvents(eventBridgeParams).promise();

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Category updated successfully with encryption',
        item: updatedCategory,
      }),
    };
  } catch (error) {
    console.error('Error updating category:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Failed to update category', error: error.message }),
    };
  }
};
