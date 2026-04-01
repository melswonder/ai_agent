import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentPlaybackState } from "@/lib/spotify/client";
import { getSessionIdFromRequest } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const sessionId = await getSessionIdFromRequest(request);

  if (!sessionId) {
    return NextResponse.json(
      { error: "Not authenticated." },
      { status: 401 },
    );
  }

  const connection = await prisma.spotifyConnection.findUnique({
    where: {
      sessionId,
    },
    select: {
      playerDeviceId: true,
    },
  });

  if (!connection) {
    return NextResponse.json(
      { error: "Spotify is not connected." },
      { status: 401 },
    );
  }

  const playback = await getCurrentPlaybackState(sessionId);

  return NextResponse.json({
    playback,
    deviceReady: Boolean(connection.playerDeviceId),
  });
}
