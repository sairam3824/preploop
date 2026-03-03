import { getModelName, getOpenAIClient } from "@/lib/openai";
import { getChatMessages, getChatSessionSummary, updateChatSessionSummary } from "@/lib/db";

type StoredMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          return typeof item.text === "string" ? item.text : "";
        }
        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

export async function getChatMemoryContext(sessionId: string, recentLimit = 12) {
  const [sessionSummary, allMessages] = await Promise.all([
    getChatSessionSummary(sessionId),
    getChatMessages(sessionId)
  ]);

  return {
    sessionSummary,
    recentMessages: allMessages.slice(-recentLimit) as StoredMessage[],
    allMessages: allMessages as StoredMessage[]
  };
}

export async function maybeRefreshChatSessionSummary(sessionId: string, force = false) {
  const [existingSummary, allMessages] = await Promise.all([
    getChatSessionSummary(sessionId),
    getChatMessages(sessionId)
  ]);

  if (!force) {
    if (allMessages.length < 10) {
      return existingSummary;
    }
    if (allMessages.length % 6 !== 0) {
      return existingSummary;
    }
  }

  const transcript = allMessages
    .slice(-40)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  const openai = getOpenAIClient();

  try {
    const completion = await openai.chat.completions.create({
      model: getModelName(),
      messages: [
        {
          role: "system",
          content:
            "Summarize chat context for memory. Keep under 10 bullet lines. Include: user goals, what has been attempted, mistakes made, hints already provided, and unresolved follow-ups."
        },
        {
          role: "user",
          content: `Existing summary:\n${existingSummary || "None"}\n\nRecent conversation:\n${transcript}`
        }
      ],
      temperature: 0.2
    });

    const summary = extractTextContent(completion.choices[0]?.message?.content).trim();
    if (!summary) {
      return existingSummary;
    }

    const normalizedSummary = summary.slice(0, 2000);
    if (normalizedSummary !== existingSummary) {
      await updateChatSessionSummary(sessionId, normalizedSummary);
    }

    return normalizedSummary;
  } catch {
    return existingSummary;
  }
}
