const AWS = require("aws-sdk");

const dynamoDB = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();
const sqs = new AWS.SQS();

const TABLE_NAME = process.env.MESSAGES_TABLE;
const REVIEW_QUEUE_URL = process.env.REVIEW_QUEUE_URL;
const DECRYPTION_LAMBDA = "sol-chap-decryption";

// 🔓 Decrypt the message fields using decryption Lambda
const decryptMessage = async (message) => {
  try {
    console.log(`🔑 Decrypting message: ${message.PK}`);

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
          PK: message.PK,
          SK: message.SK,
          GSI1PK: message.GSI1PK
        }),
      }),
    }).promise();

    const parsed = JSON.parse(response.Payload);
    if (parsed.statusCode !== 200 || !parsed.body) {
      console.error("❌ Invalid response from decryption Lambda:", parsed);
      throw new Error("Invalid decryption lambda response");
    }

    const decryptedData = JSON.parse(parsed.body).decryptedData;
    if (!decryptedData) {
      console.error("❌ Missing decryptedData in response:", parsed);
      throw new Error("Missing decryptedData in decryption response");
    }

    console.log(`✅ Message ${message.PK} decrypted successfully`);

    // Build final object with decrypted values + untouched metadata
    return {
      subject: decryptedData.subject,
      policy: decryptedData.policy,
      message: decryptedData.message,
      senderId: decryptedData.senderId,
      receiverId: decryptedData.receiverId,
      timestamp: message.timestamp,
      status: message.status,
      GSI1PK: decryptedData.GSI1PK,
      GSI1SK: message.GSI1SK,
      GSI2PK: decryptedData.receiverId,
      GSI2SK: message.GSI2SK,
      PK: decryptedData.PK,
      SK: decryptedData.SK
    };

  } catch (err) {
    console.error(`❌ Decryption failed for message ${message.PK}:`, err.message);
    return null;
  }
};

exports.handler = async (event) => {
  try {
    console.log("📥 Fetching PENDING messages from DynamoDB...");

    // Step 1: Scan messages with status === "PENDING"
    const scanParams = {
      TableName: TABLE_NAME,
      FilterExpression: "#status = :pendingStatus",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":pendingStatus": "PENDING",
      },
    };

    const scanResult = await dynamoDB.scan(scanParams).promise();
    const matchedMessages = scanResult.Items || [];

    console.log(`✅ Found ${matchedMessages.length} PENDING messages`);

    if (matchedMessages.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "No pending messages found.",
          count: 0,
        }),
      };
    }

    // Step 2: Decrypt messages
    const decryptedMessages = [];
    for (const msg of matchedMessages) {
      const decrypted = await decryptMessage(msg);
      if (!decrypted) {
        console.warn(`⚠️ Skipping message ${msg.PK} due to decryption failure.`);
        continue;
      }
      decryptedMessages.push(decrypted);
    }

    console.log(`✅ Decrypted ${decryptedMessages.length} messages`);

    // Step 3: Push decrypted messages to SQS
    for (const decrypted of decryptedMessages) {
      try {
        const sqsParams = {
          QueueUrl: REVIEW_QUEUE_URL,
          MessageBody: JSON.stringify(decrypted),
        };
        await sqs.sendMessage(sqsParams).promise();
        console.log(`📤 Message ${decrypted.PK} sent to SQS`);
      } catch (sqsErr) {
        console.error(`❌ Failed to send message ${decrypted.PK} to SQS:`, sqsErr.message);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Pending messages decrypted and pushed to SQS successfully.",
        count: decryptedMessages.length,
        data: decryptedMessages,
      }),
    };
  } catch (err) {
    console.error("🚨 Error processing messages:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to process messages",
        details: err.message,
      }),
    };
  }
};
