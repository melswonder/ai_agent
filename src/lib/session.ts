import type { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { signValue, unsignValue } from "@/lib/crypto";

const SESSION_COOKIE_NAME = "spotify_agent_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export async function createSession() {
  return prisma.session.create({
    data: {},
  });
}

export async function getSessionIdFromRequest(request: NextRequest) {
  return unsignValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

export async function getOrCreateSessionId(request: NextRequest) {
  const existingSessionId = await getSessionIdFromRequest(request);

  if (existingSessionId) {
    return existingSessionId;
  }

  const session = await createSession();
  return session.id;
}

export function attachSessionCookie(response: NextResponse, sessionId: string) {
  const env = getEnv();

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: signValue(sessionId),
    httpOnly: true,
    sameSite: "lax",
    secure:
      env.APP_URL.startsWith("https://") || process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    path: "/",
    maxAge: 0,
  });
}
