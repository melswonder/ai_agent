import { createHash, randomBytes } from "crypto";
import { decryptString, encryptString } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { getEnv, requireSpotifyEnv } from "@/lib/env";

const SPOTIFY_ACCOUNT_BASE = "https://accounts.spotify.com";

export const SPOTIFY_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
];

type SpotifyTokenResponse = {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
};

export type SpotifyProfile = {
  id: string;
  display_name: string | null;
  email?: string;
  product?: string;
};

function spotifyBasicAuthHeader() {
  const env = requireSpotifyEnv();
  return Buffer.from(
    `${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`,
  ).toString("base64");
}

async function requestSpotifyTokens(body: URLSearchParams) {
  const response = await fetch(`${SPOTIFY_ACCOUNT_BASE}/api/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${spotifyBasicAuthHeader()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Spotify token request failed: ${errorText}`);
  }

  return (await response.json()) as SpotifyTokenResponse;
}

export function createPkcePair() {
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");

  return {
    verifier,
    challenge,
  };
}

export function buildSpotifyAuthorizeUrl(state: string, codeChallenge: string) {
  const env = getEnv();
  const url = new URL(`${SPOTIFY_ACCOUNT_BASE}/authorize`);

  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", requireSpotifyEnv().SPOTIFY_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.SPOTIFY_CALLBACK_URL);
  url.searchParams.set("scope", SPOTIFY_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", codeChallenge);

  return url.toString();
}

export async function exchangeCodeForTokens(params: {
  code: string;
  codeVerifier: string;
}) {
  const env = getEnv();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: env.SPOTIFY_CALLBACK_URL,
    code_verifier: params.codeVerifier,
  });

  return requestSpotifyTokens(body);
}

export async function refreshSpotifyTokens(refreshToken: string) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  return requestSpotifyTokens(body);
}

export async function fetchSpotifyProfile(accessToken: string) {
  const response = await fetch("https://api.spotify.com/v1/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Unable to fetch Spotify profile: ${errorText}`);
  }

  return (await response.json()) as SpotifyProfile;
}

export async function getValidSpotifyAccessToken(
  sessionId: string,
  forceRefresh = false,
) {
  const connection = await prisma.spotifyConnection.findUnique({
    where: {
      sessionId,
    },
  });

  if (!connection) {
    throw new Error("Spotify account is not connected.");
  }

  const cachedAccessToken = decryptString(connection.encryptedAccessToken);
  const expiresSoon = connection.accessTokenExpiresAt.getTime() <= Date.now() + 60_000;

  if (!forceRefresh && !expiresSoon) {
    return {
      accessToken: cachedAccessToken,
      connection,
    };
  }

  const refreshToken = decryptString(connection.encryptedRefreshToken);

  if (!refreshToken) {
    throw new Error("Spotify refresh token is missing. Please reconnect Spotify.");
  }

  const refreshed = await refreshSpotifyTokens(refreshToken);
  const nextRefreshToken = refreshed.refresh_token ?? refreshToken;

  const updatedConnection = await prisma.spotifyConnection.update({
    where: {
      sessionId,
    },
    data: {
      encryptedAccessToken: encryptString(refreshed.access_token),
      encryptedRefreshToken: encryptString(nextRefreshToken),
      accessTokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
      scope: refreshed.scope || connection.scope,
    },
  });

  return {
    accessToken: refreshed.access_token,
    connection: updatedConnection,
  };
}
