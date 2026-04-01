import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isSpotifyConfigured } from "@/lib/env";
import {
  buildSpotifyAuthorizeUrl,
  createPkcePair,
} from "@/lib/spotify/oauth";
import { attachSessionCookie, getOrCreateSessionId } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isSpotifyConfigured()) {
    return NextResponse.json(
      {
        error: "Spotify credentials are not configured on the server.",
      },
      { status: 503 },
    );
  }

  const sessionId = await getOrCreateSessionId(request);
  const state = randomUUID();
  const pkce = createPkcePair();

  await prisma.session.upsert({
    where: {
      id: sessionId,
    },
    update: {
      oauthState: state,
      oauthVerifier: pkce.verifier,
    },
    create: {
      id: sessionId,
      oauthState: state,
      oauthVerifier: pkce.verifier,
    },
  });

  const response = NextResponse.redirect(
    buildSpotifyAuthorizeUrl(state, pkce.challenge),
  );

  attachSessionCookie(response, sessionId);
  return response;
}
