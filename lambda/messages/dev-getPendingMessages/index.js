const AWS = require("aws-sdk");
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();
const sqs = new AWS.SQS();

const TABLE_NAME = process.env.MESSAGES_TABLE;
const REVIEW_QUEUE_URL = process.env.REVIEW_QUEUE_URL;
const DECRYPTION_LAMBDA = "sol-chap-decryption";
const ENCRYPTION_LAMBDA = "sol-chap-encryption"; // Make sure this is defined in your Lambda console/env

// Encrypt SK value
const encryptValue = async (value) => {
  try {
    const response = await lambda.invoke({
      FunctionName: ENCRYPTION_LAMBDA,
      InvocationType: "RequestResponse",
      Payload: JSON.stringify({ body: JSON.stringify({ text: value }) }),
    }).promise();

    const parsed = JSON.parse(response.Payload);
    const encrypted = JSON.parse(parsed.body).encryptedData;

    if (!encrypted) throw new Error("Missing encryptedData from encryption lambda");
    return encrypted;
  } catch (err) {
    console.error("🔐 Encryption error:", err.message);
    throw err;
  }
};

// Decrypt the message fields
const decryptMessage = async (message) => {
  try {
    const response = await lambda.invoke({
      FunctionName: DECRYPTION_LAMBDA,
      InvocationType: "RequestResponse",
      Payload: JSON.stringify({
        body: JSON.stringify({
          senderId: message.senderId,
          receiverId: message.receiverId,
          message: message.message,
          subject: message.subject,
          policy: message.policy,
        }),
      }),
    }).promise();

    const parsed = JSON.parse(response.Payload);
    if (parsed.statusCode !== 200 || !parsed.body) {
      throw new Error("Invalid decryption lambda response");
    }

    const decryptedData = JSON.parse(parsed.body).decryptedData;
    if (!decryptedData) {
      throw new Error("Missing decryptedData in decryption response");
    }

    return {
      ...message,
      senderId: decryptedData.senderId,
      receiverId: decryptedData.receiverId,
      message: decryptedData.message,
      subject: decryptedData.subject,
      policy: decryptedData.policy,
      GSI2PK: decryptedData.receiverId,
    };
  } catch (err) {
    console.error("❌ Decryption error for message:", message.PK, err.message);
    return null;
  }
};

exports.handler = async (event) => {
  try {
    // Step 1: Encrypt the filter value for SK
    const encryptedStatus = await encryptValue("STATUS#PENDING");
    console.log("🔐 Encrypted SK for comparison:", encryptedStatus);

    // Step 2: Scan all MESSAGE# items from DynamoDB
    const scanParams = {
      TableName: TABLE_NAME,
      FilterExpression: "begins_with(PK, :prefix)",
      ExpressionAttributeValues: {
        ":prefix": "MESSAGE#",
      },
    };

    const scanResult = await dynamoDB.scan(scanParams).promise();
    const allMessages = scanResult.Items || [];
    console.log(`📦 Total messages retrieved: ${allMessages.length}`);

    // Step 3: Filter records whose SK match the encrypted SK
    const matchedMessages = allMessages.filter(item => item.SK === encryptedStatus);
    console.log(`✅ Matched messages with encrypted SK: ${matchedMessages.length}`);

    // Step 4: Decrypt and push to SQS
    for (const msg of matchedMessages) {
      const decrypted = await decryptMessage(msg);
      if (!decrypted) {
        console.warn(`⚠️ Message ${msg.PK} skipped due to decryption failure.`);
        continue;
      }

      try {
        const sqsParams = {
          QueueUrl: REVIEW_QUEUE_URL,
          MessageBody: JSON.stringify(decrypted),
        };
        await sqs.sendMessage(sqsParams).promise();
        console.log(`📤 Message ${msg.PK} sent to SQS`);
      } catch (sqsErr) {
        console.error(`❌ Failed to send message ${msg.PK} to SQS:`, sqsErr.message);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Pending messages (by encrypted SK) decrypted and pushed to SQS successfully.",
        count: matchedMessages.length,
      }),
    };
  } catch (err) {
    console.error("🚨 Error processing messages:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to process messages", details: err.message }),
    };
  }
};
