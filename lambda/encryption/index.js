// const crypto = require("crypto");

// const SECRET_KEY = process.env.AES_SECRET_KEY;
// const SECRET_IV = process.env.AES_SECRET_IV;
// const ENCRYPTION_METHOD = process.env.AES_ENCRYPTION_METHOD;

// const key = crypto.createHash("sha512").update(SECRET_KEY).digest("hex").substring(0, 32);
// const iv = crypto.createHash("sha512").update(SECRET_IV).digest("hex").substring(0, 16);

// exports.handler = async (event) => {
//     try {
//         console.log("🔐 Encrypting data:", event);

//         const { text } = event;
//         if (!text) throw new Error("Missing text to encrypt.");

//         const cipher = crypto.createCipheriv(ENCRYPTION_METHOD, key, iv);
//         let encrypted = cipher.update(text, "utf8", "hex");
//         encrypted += cipher.final("hex");

//         return {
//             statusCode: 200,
//             body: JSON.stringify({ encryptedData: Buffer.from(encrypted, "hex").toString("base64") }),
//         };
//     } catch (error) {
//         console.error("❌ Encryption error:", error);
//         return { statusCode: 500, body: JSON.stringify({ message: "Encryption failed", error: error.message }) };
//     }
// };

const crypto = require("crypto");

const SECRET_KEY = process.env.AES_SECRET_KEY;
const SECRET_IV = process.env.AES_SECRET_IV;
const ENCRYPTION_METHOD = process.env.AES_ENCRYPTION_METHOD;

const key = crypto.createHash("sha512").update(SECRET_KEY).digest("hex").substring(0, 32);
const iv = crypto.createHash("sha512").update(SECRET_IV).digest("hex").substring(0, 16);

exports.handler = async (event) => {
    try {
        console.log("🔐 Encrypting data:", event);

        const { text } = event;
        if (!text) throw new Error("Missing text to encrypt.");

        const cipher = crypto.createCipheriv(ENCRYPTION_METHOD, key, iv);
        let encrypted = cipher.update(text, "utf8", "base64"); // 🔥 Directly encode to Base64
        encrypted += cipher.final("base64");

        return {
            statusCode: 200,
            body: JSON.stringify({ encryptedData: encrypted }), // ✅ Base64 only once
        };
    } catch (error) {
        console.error("❌ Encryption error:", error);
        return { statusCode: 500, body: JSON.stringify({ message: "Encryption failed", error: error.message }) };
    }
};
