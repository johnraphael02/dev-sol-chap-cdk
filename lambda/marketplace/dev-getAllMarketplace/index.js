const AWS = require("aws-sdk");

const dynamodb = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();

const MARKETPLACE_TABLE = process.env.MARKETPLACE_TABLE;
const DECRYPTION_LAMBDA_NAME = process.env.DECRYPTION_LAMBDA_NAME || "sol-chap-decryption";

exports.handler = async (event) => {
  try {
    console.log("🔍 Fetching encrypted Marketplace items...");
    
    const result = await dynamodb.scan({ TableName: MARKETPLACE_TABLE }).promise();
    const encryptedItems = result.Items || [];

    console.log("🔒 Retrieved Encrypted Items:", JSON.stringify(encryptedItems, null, 2));

    const decryptField = async (fieldName, encryptedValue) => {
      if (!encryptedValue) return encryptedValue;

      try {
        const params = {
          FunctionName: DECRYPTION_LAMBDA_NAME,
          InvocationType: "RequestResponse",
          Payload: JSON.stringify({ body: JSON.stringify({ [fieldName]: encryptedValue }) }),
        };

        console.log(`📩 Sending ${fieldName} to Decryption Lambda:`, params);

        const response = await lambda.invoke(params).promise();
        console.log("📩 Raw Decryption Response:", JSON.stringify(response, null, 2));

        const parsedPayload = JSON.parse(response.Payload || "{}");
        console.log("📩 Parsed Payload:", parsedPayload);

        const body = parsedPayload.body ? JSON.parse(parsedPayload.body) : {};
        console.log("📩 Parsed Body:", body);

        const decryptedData = body.decryptedData || {};
        console.log("🔑 Decrypted Data:", decryptedData);

        return decryptedData[fieldName] || encryptedValue;
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

    console.log("✅ Final Decrypted Marketplace Items:", JSON.stringify(decryptedItems, null, 2));

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