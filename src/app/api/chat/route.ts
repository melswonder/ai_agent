import { ChatRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getConversation,
  getRecentConversation,
  saveChatMessage,
  toChatMessageDto,
} from "@/lib/chat";
import type { ChatResponseDto } from "@/lib/contracts";
import { prisma } from "@/lib/db";
import { isLlmConfigured } from "@/lib/env";
import { runMusicAgent } from "@/lib/agent/graph";
import { getCurrentPlaybackState } from "@/lib/spotify/client";
import { getSessionIdFromRequest } from "@/lib/session";

export const runtime = "nodejs";

const requestSchema = z.object({
  message: z.string().trim().min(1).max(400),
});

function buildFriendlyError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unexpected error occurred.";

  if (
    message.includes("NO_ACTIVE_DEVICE") ||
    message.includes("No active device found") ||
    message.includes("Player command failed")
  ) {
    return "再生先デバイスが見つかりませんでした。Spotify を接続したブラウザでプレイヤーが準備できているか確認してください。";
  }

  if (message.includes("OPENAI_API_KEY")) {
    return "LLM の設定がまだないため、チャットで曲変更できません。OPENAI_API_KEY を設定してください。";
  }

  return "うまく操作を完了できませんでした。Spotify 接続とプレイヤー準備状況を確認して、もう一度試してください。";
}

export async function POST(request: NextRequest) {
  const sessionId = await getSessionIdFromRequest(request);

  if (!sessionId) {
    return NextResponse.json(
      { error: "Not authenticated." },
      { status: 401 },
    );
  }

  if (!isLlmConfigured()) {
    return NextResponse.json(
      {
        error: "OPENAI_API_KEY is not configured.",
      },
      { status: 503 },
    );
  }

  const body = requestSchema.safeParse(await request.json());

  if (!body.success) {
    return NextResponse.json(
      {
        error: "Invalid message payload.",
      },
      { status: 400 },
    );
  }

  const connection = await prisma.spotifyConnection.findUnique({
    where: {
      sessionId,
    },
    select: {
      sessionId: true,
    },
  });

  if (!connection) {
    return NextResponse.json(
      {
        error: "Spotify is not connected.",
      },
      { status: 401 },
    );
  }

  const history = await getRecentConversation(sessionId, 18);
  await saveChatMessage(sessionId, ChatRole.USER, body.data.message);

  try {
    const result = await runMusicAgent({
      sessionId,
      history: history.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      input: body.data.message,
    });

    const assistantRecord = await saveChatMessage(
      sessionId,
      ChatRole.ASSISTANT,
      result.assistantMessage,
    );
    const messages = await getConversation(sessionId);
    const playback = await getCurrentPlaybackState(sessionId).catch(() => null);

    return NextResponse.json({
      messages: toChatMessageDto(messages),
      playback,
      assistantMessage: {
        id: assistantRecord.id,
        role: "assistant",
        content: assistantRecord.content,
        createdAt: assistantRecord.createdAt.toISOString(),
      },
    } satisfies ChatResponseDto);
  } catch (error) {
    console.error(error);

    const fallback = await saveChatMessage(
      sessionId,
      ChatRole.ASSISTANT,
      buildFriendlyError(error),
    );
    const messages = await getConversation(sessionId);

    return NextResponse.json(
      {
        messages: toChatMessageDto(messages),
        playback: await getCurrentPlaybackState(sessionId).catch(() => null),
        assistantMessage: {
          id: fallback.id,
          role: "assistant",
          content: fallback.content,
          createdAt: fallback.createdAt.toISOString(),
        },
      } satisfies ChatResponseDto,
      { status: 500 },
    );
  }
}
