import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionIdFromRequest } from "@/lib/session";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest) {
  const sessionId = await getSessionIdFromRequest(request);

  if (!sessionId) {
    return NextResponse.json({
      ok: true,
      deletedCount: 0,
    });
  }

  const deleted = await prisma.chatMessage.deleteMany({
    where: {
      sessionId,
    },
  });

  return NextResponse.json({
    ok: true,
    deletedCount: deleted.count,
  });
}
