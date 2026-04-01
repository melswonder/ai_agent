import { NextRequest, NextResponse } from "next/server";
import { encryptString } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { getEnv, isSpotifyConfigured } from "@/lib/env";
import {
  exchangeCodeForTokens,
  fetchSpotifyProfile,
} from "@/lib/spotify/oauth";
import { attachSessionCookie } from "@/lib/session";

export const runtime = "nodejs";

function redirectWithError(request: NextRequest, authError: string) {
  const url = new URL("/", getEnv().APP_URL);
  url.searchParams.set("authError", authError);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  if (!isSpotifyConfigured()) {
    return redirectWithError(request, "spotify_config_missing");
  }

  const authError = request.nextUrl.searchParams.get("error");
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  if (authError) {
    return redirectWithError(request, authError);
  }

  if (!code || !state) {
    return redirectWithError(request, "oauth_state_invalid");
  }

  const session = await prisma.session.findUnique({
    where: {
      oauthState: state,
    },
  });

  if (!session?.oauthVerifier) {
    return redirectWithError(request, "oauth_state_invalid");
  }

  try {
    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: session.oauthVerifier,
    });
    const profile = await fetchSpotifyProfile(tokens.access_token);
    const encryptedAccessToken = encryptString(tokens.access_token);
    const encryptedRefreshToken = encryptString(tokens.refresh_token ?? "");
    const accessTokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await prisma.$transaction(async (tx) => {
      const previousConnection = await tx.spotifyConnection.findFirst({
        where: {
          OR: [{ sessionId: session.id }, { spotifyUserId: profile.id }],
        },
        orderBy: {
          updatedAt: "desc",
        },
        select: {
          playerDeviceId: true,
        },
      });

      await tx.spotifyConnection.deleteMany({
        where: {
          OR: [{ sessionId: session.id }, { spotifyUserId: profile.id }],
        },
      });

      await tx.spotifyConnection.create({
        data: {
          sessionId: session.id,
          spotifyUserId: profile.id,
          displayName: profile.display_name,
          scope: tokens.scope,
          encryptedAccessToken,
          encryptedRefreshToken,
          accessTokenExpiresAt,
          playerDeviceId: previousConnection?.playerDeviceId ?? null,
        },
      });

      await tx.session.update({
        where: {
          id: session.id,
        },
        data: {
          oauthState: null,
          oauthVerifier: null,
        },
      });
    });

    const response = NextResponse.redirect(new URL("/", getEnv().APP_URL));
    attachSessionCookie(response, session.id);
    return response;
  } catch (error) {
    console.error(error);
    return redirectWithError(request, "token_exchange_failed");
  }
}
