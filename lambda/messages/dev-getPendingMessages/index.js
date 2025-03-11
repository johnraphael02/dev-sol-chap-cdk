const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();
const sqs = new AWS.SQS();

const TABLE_NAME = process.env.MESSAGES_TABLE;
const REVIEW_QUEUE_URL = process.env.REVIEW_QUEUE_URL;
const DECRYPTION_LAMBDA = "sol-chap-decryption";
const ENCRYPTION_LAMBDA = "sol-chap-encryption"; // Assumed encryption lambda name

// Helper: Encrypt a value using the encryption Lambda
async function encryptValue(value) {
  try {
    const response = await lambda.invoke({
      FunctionName: ENCRYPTION_LAMBDA,
      InvocationType: "RequestResponse",
      Payload: JSON.stringify({ body: JSON.stringify({ text: value }) })
    }).promise();

    const parsed = JSON.parse(response.Payload);
    if (parsed.statusCode !== 200 || !parsed.body) throw new Error("Invalid encryption response");

    const encrypted = JSON.parse(parsed.body).encryptedData;
    return encrypted;
  } catch (err) {
    console.error("🔐 Encryption error:", err);
    throw err;
  }
}

// Helper: Decrypt message fields using decryption Lambda
async function decryptMessage(message) {
  try {
    const decryptionResponse = await lambda.invoke({
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

    const parsed = JSON.parse(decryptionResponse.Payload);
    const decryptedData = JSON.parse(parsed.body).decryptedData;

    if (!decryptedData) throw new Error("Missing decrypted data");

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
    console.error("❌ Decryption failed:", err.message);
    return null;
  }
}

exports.handler = async (event) => {
  try {
    // Step 1: Encrypt 'STATUS#PENDING'
    const encryptedStatus = await encryptValue("STATUS#PENDING");
    console.log("🔐 Encrypted STATUS#PENDING:", encryptedStatus);

    // Step 2: Scan all items starting with MESSAGE#
    const params = {
      TableName: TABLE_NAME,
      FilterExpression: "begins_with(PK, :pkPrefix)",
      ExpressionAttributeValues: {
        ":pkPrefix": "MESSAGE#"
      }
    };

    const data = await dynamoDB.scan(params).promise();
    let messages = data.Items || [];

    console.log(`📦 Retrieved ${messages.length} messages from DynamoDB`);

    // Step 3: Filter messages where SK === encryptedStatus
    const pendingMessages = messages.filter(msg => msg.SK === encryptedStatus);
    console.log(`🟡 Filtered ${pendingMessages.length} PENDING encrypted messages`);

    // Step 4: Decrypt each valid message
    const decryptedMessages = [];
    for (const msg of pendingMessages) {
      const decrypted = await decryptMessage(msg);
      if (decrypted) decryptedMessages.push(decrypted);
    }

    // Step 5: Send each decrypted message to SQS
    for (const message of decryptedMessages) {
      try {
        const sqsParams = {
          QueueUrl: REVIEW_QUEUE_URL,
          MessageBody: JSON.stringify(message),
        };
        await sqs.sendMessage(sqsParams).promise();
        console.log(`📤 Message ${message.PK} sent to SQS`);
      } catch (sqsErr) {
        console.error(`❌ Failed to send message ${message.PK} to SQS:`, sqsErr);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Encrypted SK filter applied. Messages decrypted and sent to SQS.",
        count: decryptedMessages.length,
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
