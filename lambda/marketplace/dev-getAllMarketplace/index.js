const AWS = require("aws-sdk");

const dynamodb = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();

const MARKETPLACE_TABLE = process.env.MARKETPLACE_TABLE;
const DECRYPTION_LAMBDA = "sol-chap-decryption";

/**
 * Invoke decryption Lambda
 */
async function decryptData(encryptedObject) {
  const params = {
    FunctionName: DECRYPTION_LAMBDA,
    InvocationType: "RequestResponse",
    Payload: JSON.stringify({ body: JSON.stringify(encryptedObject) }), // Standard structure
  };

  try {
    console.log("🔑 Sending to Decryption Lambda:", JSON.stringify(encryptedObject, null, 2));
    const response = await lambda.invoke(params).promise();

    if (!response.Payload) {
      throw new Error("Empty payload from Decryption Lambda");
    }

    const parsed = JSON.parse(response.Payload);

    if (parsed.statusCode !== 200 || !parsed.body) {
      throw new Error(`Decryption failed: ${parsed.body || "No body returned"}`);
    }

    const decryptedBody = JSON.parse(parsed.body);

    if (!decryptedBody.decryptedData) {
      throw new Error("Missing decryptedData in Lambda response");
    }

    return decryptedBody.decryptedData;
  } catch (err) {
    console.error("❌ Decryption Error:", err);
    return null;
  }
}

exports.handler = async (event) => {
  console.log("📥 Event received:", JSON.stringify(event));

  try {
    const params = {
      TableName: MARKETPLACE_TABLE,
    };

    const result = await dynamodb.scan(params).promise();
    const items = result.Items || [];

    console.log(`📦 Retrieved ${items.length} marketplace items.`);

    const decryptedItems = await Promise.all(items.map(async (item) => {
      // Prepare only necessary encrypted fields
      const encryptedPayload = {
        PK: item.PK,
        SK: item.SK,
        name: item.name,
        description: item.description,
        category: item.category,
        GSI1PK: item.GSI1PK,
        GSI1SK: item.GSI1SK,
      };

      const decrypted = await decryptData(encryptedPayload);

      if (!decrypted) {
        console.warn("⚠️ Skipping item due to decryption failure:", item.PK);
        return null;
      }

      // Include original timestamps
      return {
        ...decrypted,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    }));

    const filtered = decryptedItems.filter((item) => item !== null);

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, GET",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: JSON.stringify({ message: "Marketplace data retrieved successfully.", data: filtered }),
    };
  } catch (error) {
    console.error("🚨 Error processing marketplace data:", error);
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, GET",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: JSON.stringify({ message: "Internal Server Error", error: error.message }),
    };
  }
};
