import { NextRequest, NextResponse } from "next/server";
import { getConversation, toChatMessageDto } from "@/lib/chat";
import type { SessionDto } from "@/lib/contracts";
import { prisma } from "@/lib/db";
import { getEnv, isLlmConfigured, isSpotifyConfigured } from "@/lib/env";
import { getCurrentPlaybackState } from "@/lib/spotify/client";
import { getSessionIdFromRequest } from "@/lib/session";

export const runtime = "nodejs";

function createEmptyState(): SessionDto {
  return {
    authenticated: false,
    spotifyConfigured: isSpotifyConfigured(),
    llmConfigured: isLlmConfigured(),
    deviceReady: false,
    callbackUrl: getEnv().SPOTIFY_CALLBACK_URL,
    profile: null,
    messages: [],
    playback: null,
  };
}

export async function GET(request: NextRequest) {
  const sessionId = await getSessionIdFromRequest(request);

  if (!sessionId) {
    return NextResponse.json(createEmptyState());
  }

  const session = await prisma.session.findUnique({
    where: {
      id: sessionId,
    },
    include: {
      spotifyConnection: {
        select: {
          spotifyUserId: true,
          displayName: true,
          playerDeviceId: true,
        },
      },
    },
  });

  if (!session) {
    return NextResponse.json(createEmptyState());
  }

  const messages = await getConversation(sessionId);
  const playback = session.spotifyConnection
    ? await getCurrentPlaybackState(sessionId).catch(() => null)
    : null;

  return NextResponse.json({
    authenticated: Boolean(session.spotifyConnection),
    spotifyConfigured: isSpotifyConfigured(),
    llmConfigured: isLlmConfigured(),
    deviceReady: Boolean(session.spotifyConnection?.playerDeviceId),
    callbackUrl: getEnv().SPOTIFY_CALLBACK_URL,
    profile: session.spotifyConnection
      ? {
          displayName: session.spotifyConnection.displayName,
          spotifyUserId: session.spotifyConnection.spotifyUserId,
        }
      : null,
    messages: toChatMessageDto(messages),
    playback,
  } satisfies SessionDto);
}
