import { ChatRole } from "@prisma/client";
import type { ChatMessageDto } from "@/lib/contracts";
import { prisma } from "@/lib/db";

export async function getConversation(sessionId: string) {
  return prisma.chatMessage.findMany({
    where: {
      sessionId,
    },
    orderBy: {
      createdAt: "asc",
    },
  });
}

export async function getRecentConversation(sessionId: string, limit = 16) {
  const messages = await prisma.chatMessage.findMany({
    where: {
      sessionId,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: limit,
  });

  return messages.reverse();
}

export async function saveChatMessage(
  sessionId: string,
  role: ChatRole,
  content: string,
) {
  return prisma.chatMessage.create({
    data: {
      sessionId,
      role,
      content: content.trim(),
    },
  });
}

export function toChatMessageDto(
  messages: {
    id: string;
    role: ChatRole;
    content: string;
    createdAt: Date;
  }[],
): ChatMessageDto[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role === ChatRole.USER ? "user" : "assistant",
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  }));
}
