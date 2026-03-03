import { NextRequest } from "next/server";
import { getAuthContext, unauthorizedResponse } from "@/lib/auth";
import { ensureChatSession, getChatMessages, saveChatMessage } from "@/lib/db";
import { getModelName, getOpenAIClient } from "@/lib/openai";
import { getServiceClient } from "@/lib/supabase/server";

interface ChatPayload {
  dailyQuestionId: string;
  message: string;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
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

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const dailyQuestionId = req.nextUrl.searchParams.get("dailyQuestionId");

    if (!dailyQuestionId) {
      return Response.json({ error: "dailyQuestionId is required." }, { status: 400 });
    }

    const sessionId = await ensureChatSession(auth.userId, dailyQuestionId);
    const messages = await getChatMessages(sessionId);

    return Response.json({ sessionId, messages });
  } catch (error) {
    return unauthorizedResponse(error instanceof Error ? error.message : "Unauthorized");
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const body = (await req.json()) as ChatPayload;

    if (!body.dailyQuestionId || !body.message?.trim()) {
      return Response.json({ error: "dailyQuestionId and message are required." }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { data: daily, error: dailyError } = await supabase
      .from("daily_questions")
      .select("id, question:questions(prompt, ideal_answer)")
      .eq("id", body.dailyQuestionId)
      .eq("user_id", auth.userId)
      .single();

    if (dailyError || !daily) {
      return Response.json({ error: "Daily question not found." }, { status: 404 });
    }

    const question = Array.isArray(daily.question) ? daily.question[0] : daily.question;

    const sessionId = await ensureChatSession(auth.userId, body.dailyQuestionId);
    const messages = await getChatMessages(sessionId);

    const openai = getOpenAIClient();
    const response = await openai.chat.completions.create({
      model: getModelName(),
      messages: [
        {
          role: "system",
          content:
            "You are an interview coach. Keep responses concise, actionable, and avoid fully revealing the ideal answer unless the user explicitly gives up."
        },
        {
          role: "system",
          content: `Question: ${question?.prompt}\nIdeal answer reference: ${question?.ideal_answer}`
        },
        ...messages.slice(-12).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content
        })),
        {
          role: "user",
          content: body.message.trim()
        }
      ],
      temperature: 0.5
    });

    const assistantReply =
      extractTextContent(response.choices[0]?.message?.content) ||
      "Break your response into three parts: context, approach, and measurable result.";

    await saveChatMessage(sessionId, "user", body.message.trim());
    await saveChatMessage(sessionId, "assistant", assistantReply);

    return Response.json({ reply: assistantReply, sessionId });
  } catch (error) {
    return unauthorizedResponse(error instanceof Error ? error.message : "Unauthorized");
  }
}
