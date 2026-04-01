import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "crypto";
import { requireEncryptionKey, requireSessionSecret } from "@/lib/env";

function deriveKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

export function encryptString(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveKey(requireEncryptionKey()),
    iv,
  );

  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptString(payload: string) {
  const [iv, tag, encrypted] = payload.split(".");

  if (!iv || !tag || !encrypted) {
    throw new Error("Encrypted token payload is malformed.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(requireEncryptionKey()),
    Buffer.from(iv, "base64url"),
  );

  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

function signatureFor(value: string) {
  return createHmac("sha256", requireSessionSecret())
    .update(value)
    .digest("base64url");
}

export function signValue(value: string) {
  return `${value}.${signatureFor(value)}`;
}

export function unsignValue(signedValue: string | undefined) {
  if (!signedValue) {
    return null;
  }

  const separatorIndex = signedValue.lastIndexOf(".");

  if (separatorIndex === -1) {
    return null;
  }

  const value = signedValue.slice(0, separatorIndex);
  const providedSignature = signedValue.slice(separatorIndex + 1);
  const expectedSignature = signatureFor(value);

  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (providedBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null;
  }

  return value;
}
