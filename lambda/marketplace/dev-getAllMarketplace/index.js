// const AWS = require("aws-sdk");

// const dynamodb = new AWS.DynamoDB.DocumentClient();
// const lambda = new AWS.Lambda();

// const MARKETPLACE_TABLE = process.env.MARKETPLACE_TABLE;
// const DECRYPTION_LAMBDA_NAME = process.env.DECRYPTION_LAMBDA_NAME;

// exports.handler = async (event) => {
//   try {
//     // ✅ Fetch all items from the Marketplace table
//     const params = {
//       TableName: MARKETPLACE_TABLE,
//     };

//     const result = await dynamodb.scan(params).promise();
//     const encryptedItems = result.Items || [];

//     // ✅ Decrypt each item using the decryption Lambda
//     const decryptedItems = await Promise.all(
//       encryptedItems.map(async (item) => {
//         try {
//           // ✅ Pass name and description to the decryption Lambda
//           const decryptionParams = {
//             FunctionName: DECRYPTION_LAMBDA_NAME,
//             Payload: JSON.stringify({
//               encryptedFields: {
//                 name: item.name,
//                 description: item.description,
//               },
//             }),
//           };

//           const decryptionResponse = await lambda.invoke(decryptionParams).promise();
//           const decryptedData = JSON.parse(decryptionResponse.Payload);

//           // ✅ Debugging: Check what the decryption Lambda returns
//           console.log("Decryption Response:", decryptedData);

//           // ✅ Merge decrypted data with the original item
//           return {
//             ...item,
//             name: decryptedData.name || item.name, // Replace with decrypted value
//             description: decryptedData.description || item.description, // Replace with decrypted value
//           };
//         } catch (error) {
//           console.error("Error decrypting item:", error);
//           return item; // Return original if decryption fails
//         }
//       })
//     );

//     return {
//       statusCode: 200,
//       body: JSON.stringify({
//         message: "Fetched Marketplace items successfully",
//         data: decryptedItems,
//       }),
//     };
//   } catch (error) {
//     console.error("Error fetching Marketplace items:", error);
//     return {
//       statusCode: 500,
//       body: JSON.stringify({ message: "Error fetching marketplace items", error }),
//     };
//   }
// };

const AWS = require("aws-sdk");

const dynamodb = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();

const MARKETPLACE_TABLE = process.env.MARKETPLACE_TABLE;
const DECRYPTION_LAMBDA_NAME = process.env.DECRYPTION_LAMBDA_NAME;

exports.handler = async (event) => {
  try {
    // ✅ Fetch all items from the Marketplace table
    const params = {
      TableName: MARKETPLACE_TABLE,
    };

    const result = await dynamodb.scan(params).promise();
    const encryptedItems = result.Items || [];

    // ✅ Function to decrypt a single field
    const decryptField = async (encryptedText) => {
      if (!encryptedText) return encryptedText; // Return as is if undefined
      try {
        const decryptionParams = {
          FunctionName: DECRYPTION_LAMBDA_NAME,
          Payload: JSON.stringify({ encryptedText }), // ✅ Send only the required field
        };

        console.log("📩 Sending to Decryption Lambda:", JSON.stringify(decryptionParams, null, 2));

        const decryptionResponse = await lambda.invoke(decryptionParams).promise();

        // ✅ Ensure proper JSON parsing
        const parsedPayload = JSON.parse(decryptionResponse.Payload);
        const decryptedData = parsedPayload.decryptedData || encryptedText; // Fallback to original if undefined

        console.log("✅ Decrypted Data:", decryptedData);
        return decryptedData;
      } catch (error) {
        console.error("❌ Error decrypting field:", error);
        return encryptedText; // Return encrypted value if decryption fails
      }
    };

    // ✅ Decrypt all items in parallel
    const decryptedItems = await Promise.all(
      encryptedItems.map(async (item) => {
        const decryptedName = await decryptField(item.name);
        const decryptedDescription = await decryptField(item.description);

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
        message: "Fetched Marketplace items successfully",
        data: decryptedItems,
      }),
    };
  } catch (error) {
    console.error("❌ Error fetching Marketplace items:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Error fetching marketplace items", error }),
    };
  }
};

