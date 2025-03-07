// const crypto = require("crypto");

// const SECRET_KEY = process.env.AES_SECRET_KEY;
// const SECRET_IV = process.env.AES_SECRET_IV;
// const ENCRYPTION_METHOD = process.env.AES_ENCRYPTION_METHOD;

// const key = crypto.createHash("sha512").update(SECRET_KEY).digest("hex").substring(0, 32);
// const iv = crypto.createHash("sha512").update(SECRET_IV).digest("hex").substring(0, 16);

// exports.handler = async (event) => {
//     try {
//         console.log("🔓 Decrypting data:", event);

//         const { encryptedText } = event;
//         if (!encryptedText) throw new Error("Missing encryptedText in payload.");

//         const decipher = crypto.createDecipheriv(ENCRYPTION_METHOD, key, iv);
//         let decrypted = decipher.update(Buffer.from(encryptedText, "base64").toString("hex"), "hex", "utf8");
//         decrypted += decipher.final("utf8");

//         return {
//             statusCode: 200,
//             body: JSON.stringify({ decryptedData: decrypted }),
//         };
//     } catch (error) {
//         console.error("❌ Decryption error:", error);
//         return { statusCode: 500, body: JSON.stringify({ message: "Decryption failed", error: error.message }) };
//     }
// };

const crypto = require("crypto");

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; // Ensure this is 32 bytes
const IV_LENGTH = 16; // AES Block size

exports.handler = async (event) => {
  try {
    const { encryptedText } = JSON.parse(event.body || event);

    if (!encryptedText) {
      return { statusCode: 400, body: JSON.stringify({ message: "Missing encryptedText" }) };
    }

    const decryptedData = decrypt(encryptedText);

    return {
      statusCode: 200,
      body: JSON.stringify({ decryptedData }),
    };
  } catch (error) {
    console.error("Decryption error:", error);
    return { statusCode: 500, body: JSON.stringify({ message: "Decryption failed", error }) };
  }
};

// ✅ Decrypt Function
const decrypt = (text) => {
  let encryptedBuffer = Buffer.from(text, "base64");
  let iv = encryptedBuffer.slice(0, IV_LENGTH);
  let encryptedText = encryptedBuffer.slice(IV_LENGTH);

  let decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY, "hex"), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString();
};
