import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { clearSessionCookie } from "@/lib/session";
import { getSessionIdFromRequest } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const sessionId = await getSessionIdFromRequest(request);

  if (sessionId) {
    await prisma.spotifyConnection.deleteMany({
      where: {
        sessionId,
      },
    });
  }

  const response = NextResponse.json({
    ok: true,
  });

  clearSessionCookie(response);
  return response;
}
