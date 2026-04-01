import { z } from "zod";

function emptyToUndefined(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

const envSchema = z.object({
  APP_URL: z.string().url().default("https://127.0.0.1:8000"),
  DATABASE_URL: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(16).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).default("gpt-4.1-mini"),
  SPOTIFY_CLIENT_ID: z.string().min(1).optional(),
  SPOTIFY_CLIENT_SECRET: z.string().min(1).optional(),
  SPOTIFY_CALLBACK_URL: z
    .string()
    .url()
    .default("https://127.0.0.1:8000/callbacks"),
  SPOTIFY_TOKEN_ENCRYPTION_KEY: z.string().min(16).optional(),
});

let cachedEnv: z.infer<typeof envSchema> | null = null;

export function getEnv() {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse({
      APP_URL: process.env.APP_URL,
      DATABASE_URL: emptyToUndefined(process.env.DATABASE_URL),
      SESSION_SECRET: emptyToUndefined(process.env.SESSION_SECRET),
      OPENAI_API_KEY: emptyToUndefined(process.env.OPENAI_API_KEY),
      OPENAI_MODEL: emptyToUndefined(process.env.OPENAI_MODEL),
      SPOTIFY_CLIENT_ID: emptyToUndefined(process.env.SPOTIFY_CLIENT_ID),
      SPOTIFY_CLIENT_SECRET: emptyToUndefined(process.env.SPOTIFY_CLIENT_SECRET),
      SPOTIFY_CALLBACK_URL: emptyToUndefined(process.env.SPOTIFY_CALLBACK_URL),
      SPOTIFY_TOKEN_ENCRYPTION_KEY: emptyToUndefined(
        process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY,
      ),
    });
  }

  return cachedEnv;
}

export function requireSessionSecret() {
  const env = getEnv();

  if (!env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required.");
  }

  return env.SESSION_SECRET;
}

export function requireEncryptionKey() {
  const env = getEnv();

  if (!env.SPOTIFY_TOKEN_ENCRYPTION_KEY) {
    throw new Error("SPOTIFY_TOKEN_ENCRYPTION_KEY is required.");
  }

  return env.SPOTIFY_TOKEN_ENCRYPTION_KEY;
}

export function requireSpotifyEnv() {
  const env = getEnv();

  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
    throw new Error(
      "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be configured.",
    );
  }

  return {
    ...env,
    SPOTIFY_CLIENT_ID: env.SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET: env.SPOTIFY_CLIENT_SECRET,
  };
}

export function requireOpenAIEnv() {
  const env = getEnv();

  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  return {
    ...env,
    OPENAI_API_KEY: env.OPENAI_API_KEY,
  };
}

export function isSpotifyConfigured() {
  return Boolean(
    process.env.SPOTIFY_CLIENT_ID &&
      process.env.SPOTIFY_CLIENT_SECRET &&
      process.env.SPOTIFY_CALLBACK_URL,
  );
}

export function isLlmConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}
