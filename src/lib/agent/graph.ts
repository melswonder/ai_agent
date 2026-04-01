import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { requireOpenAIEnv } from "@/lib/env";
import { createSpotifyTools } from "@/lib/spotify/tools";

const SYSTEM_PROMPT = `
You are "Spotify Chat DJ", a Japanese-speaking agent that controls Spotify playback.

Rules:
- Always answer in Japanese.
- When the user asks to change, start, stop, skip, queue, or tune the music, use tools.
- Infer likely music search terms from mood words like "落ち着いた", "ドライブ向け", "テンション上がる", "夜っぽい".
- If the user intent clearly implies immediate playback, perform the action instead of asking for confirmation.
- If the request is ambiguous, ask one short follow-up question.
- Keep the final answer short, concrete, and mention what changed.
`;

type ConversationMessage = {
  role: "USER" | "ASSISTANT";
  content: string;
};

type RunMusicAgentParams = {
  sessionId: string;
  history: ConversationMessage[];
  input: string;
};

function toLangChainHistory(messages: ConversationMessage[]): BaseMessage[] {
  return messages.map((message) =>
    message.role === "USER"
      ? new HumanMessage(message.content)
      : new AIMessage(message.content),
  );
}

function contentToText(content: AIMessage["content"]) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if ("text" in part && typeof part.text === "string") {
          return part.text;
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

export async function runMusicAgent({
  sessionId,
  history,
  input,
}: RunMusicAgentParams) {
  const env = requireOpenAIEnv();
  const tools = createSpotifyTools(sessionId);
  const model = new ChatOpenAI({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    temperature: 0.3,
    useResponsesApi: false,
  }).bindTools(tools);

  const graph = new StateGraph(MessagesAnnotation)
    .addNode("agent", async (state: typeof MessagesAnnotation.State) => {
      const response = await model.invoke([
        new SystemMessage(SYSTEM_PROMPT),
        ...state.messages,
      ]);

      return {
        messages: [response],
      };
    })
    .addNode("tools", new ToolNode(tools))
    .addEdge(START, "agent")
    .addConditionalEdges("agent", toolsCondition, ["tools", END])
    .addEdge("tools", "agent")
    .compile();

  const result = await graph.invoke(
    {
      messages: [...toLangChainHistory(history), new HumanMessage(input)],
    },
    {
      recursionLimit: 12,
    },
  );

  const lastMessage = result.messages[result.messages.length - 1];
  const toolMessages = result.messages.filter(
    (message): message is ToolMessage => message instanceof ToolMessage,
  );

  const assistantMessage =
    lastMessage instanceof AIMessage
      ? contentToText(lastMessage.content)
      : "操作を反映しました。";

  return {
    assistantMessage:
      assistantMessage || "操作は完了しました。必要なら次の曲調も調整できます。",
    toolMessages: toolMessages.map((message) => message.content),
  };
}
