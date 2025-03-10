const AWS = require("aws-sdk");

const dynamodb = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();

const MARKETPLACE_TABLE = process.env.MARKETPLACE_TABLE;
const DECRYPTION_LAMBDA_NAME = process.env.DECRYPTION_LAMBDA_NAME;

exports.handler = async (event) => {
  try {
    const result = await dynamodb.scan({ TableName: MARKETPLACE_TABLE }).promise();
    const encryptedItems = result.Items || [];

    const decryptField = async (fieldName, encryptedValue) => {
      if (!encryptedValue) return encryptedValue;

      try {
        const params = {
          FunctionName: DECRYPTION_LAMBDA_NAME,
          Payload: JSON.stringify({ [fieldName]: encryptedValue }),
        };

        const response = await lambda.invoke(params).promise();
        const parsedPayload = JSON.parse(response.Payload || "{}");
        const body = parsedPayload.body ? JSON.parse(parsedPayload.body) : {};
        const decryptedData = body.decryptedData || {};
        const decryptedValue = decryptedData[fieldName];

        return decryptedValue || encryptedValue;
      } catch (err) {
        console.error(`❌ Error decrypting ${fieldName}:`, err.message);
        return encryptedValue;
      }
    };

    const decryptedItems = await Promise.all(
      encryptedItems.map(async (item) => {
        const decryptedName = await decryptField("name", item.name);
        const decryptedDescription = await decryptField("description", item.description);

        return {
          ...item,
          name: decryptedName,
          description: decryptedDescription,
        };
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Fetched and decrypted marketplace items successfully",
        data: decryptedItems,
      }),
    };
  } catch (error) {
    console.error("❌ Error in getAllMarketplace:", error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error in getAllMarketplace",
        error: error.message,
      }),
    };
  }
};
