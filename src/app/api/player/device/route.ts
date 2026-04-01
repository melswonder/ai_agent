import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentPlaybackState, setPreferredPlayerDevice } from "@/lib/spotify/client";
import { getSessionIdFromRequest } from "@/lib/session";

export const runtime = "nodejs";

const deviceSchema = z.object({
  deviceId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const sessionId = await getSessionIdFromRequest(request);

  if (!sessionId) {
    return NextResponse.json(
      { error: "Not authenticated." },
      { status: 401 },
    );
  }

  const parsed = deviceSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid device payload." },
      { status: 400 },
    );
  }

  await setPreferredPlayerDevice(sessionId, parsed.data.deviceId);
  const playback = await getCurrentPlaybackState(sessionId).catch(() => null);

  return NextResponse.json({
    ok: true,
    playback,
  });
}
