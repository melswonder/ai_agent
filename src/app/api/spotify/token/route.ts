import { NextRequest, NextResponse } from "next/server";
import { getBrowserPlaybackToken } from "@/lib/spotify/client";
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

  try {
    const accessToken = await getBrowserPlaybackToken(sessionId);
    return NextResponse.json({
      accessToken,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unable to retrieve a Spotify playback token." },
      { status: 401 },
    );
  }
}
