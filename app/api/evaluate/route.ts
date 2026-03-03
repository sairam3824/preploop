import { NextRequest } from "next/server";
import { getAuthContext, unauthorizedResponse } from "@/lib/auth";
import {
  ensureChatSession,
  getChatMessages,
  incrementHint,
  saveChatMessage,
  saveEvaluation,
  saveGiveUp
} from "@/lib/db";
import { getModelName, getOpenAIClient } from "@/lib/openai";
import { getServiceClient } from "@/lib/supabase/server";
import { EvaluationFeedback, GiveUpFeedback } from "@/lib/types";

interface EvaluatePayload {
  action: "hint" | "submit" | "giveup";
  dailyQuestionId: string;
  answer?: string;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

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

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const body = (await req.json()) as EvaluatePayload;
    const answer = (body.answer ?? "").trim();

    if (!body.dailyQuestionId || !body.action) {
      return Response.json({ error: "dailyQuestionId and action are required." }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { data: record, error: recordError } = await supabase
      .from("daily_questions")
      .select("id, user_id, locked, hints_used, question:questions(prompt, ideal_answer, key_points, difficulty)")
      .eq("id", body.dailyQuestionId)
      .eq("user_id", auth.userId)
      .single();

    if (recordError || !record) {
      return Response.json({ error: "Daily question not found." }, { status: 404 });
    }

    const question = Array.isArray(record.question) ? record.question[0] : record.question;
    if (!question) {
      return Response.json({ error: "Question details missing." }, { status: 500 });
    }

    if (record.locked) {
      return Response.json({ error: "This question is already locked for today." }, { status: 409 });
    }

    const sessionId = await ensureChatSession(auth.userId, body.dailyQuestionId);

    if (body.action === "hint") {
      if (!answer) {
        return Response.json({ error: "Provide current draft answer to get a focused hint." }, { status: 400 });
      }

      const openai = getOpenAIClient();
      const completion = await openai.chat.completions.create({
        model: getModelName(),
        messages: [
          {
            role: "system",
            content:
              "You are an interview coach. Give one concise hint that nudges the user forward without revealing the full answer."
          },
          {
            role: "user",
            content: `Question: ${question.prompt}\nDraft Answer: ${answer}\nKey Points: ${(question.key_points ?? []).join(", ")}`
          }
        ],
        temperature: 0.4
      });

      const hint = extractTextContent(completion.choices[0]?.message?.content) ||
        "Focus on structuring your response into problem framing, approach, and trade-offs.";
      const hintsUsed = await incrementHint(body.dailyQuestionId);

      await saveChatMessage(sessionId, "user", `Hint request\n${answer}`);
      await saveChatMessage(sessionId, "assistant", hint);

      return Response.json({ hint, hintsUsed });
    }

    if (body.action === "giveup") {
      const openai = getOpenAIClient();

      const completion = await openai.chat.completions.create({
        model: getModelName(),
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Return strict JSON with keys: modelAnswer (string), comparison ({didWell:string[], gaps:string[]}), guidance (string[])."
          },
          {
            role: "user",
            content: `Question: ${question.prompt}\nUser Answer: ${answer || "No answer submitted"}\nIdeal Answer: ${question.ideal_answer}`
          }
        ],
        temperature: 0.2
      });

      const feedback = parseJson<GiveUpFeedback>(
        extractTextContent(completion.choices[0]?.message?.content),
        {
          modelAnswer: question.ideal_answer,
          comparison: {
            didWell: answer ? ["You attempted the question."] : ["You reviewed the question before giving up."],
            gaps: ["A complete structured answer was missing."]
          },
          guidance: ["Practice answering with a clear structure and examples."]
        }
      );

      await saveGiveUp({
        userId: auth.userId,
        dailyQuestionId: body.dailyQuestionId,
        answer,
        feedback
      });

      await saveChatMessage(sessionId, "user", `I gave up. Draft answer:\n${answer || "No draft"}`);
      await saveChatMessage(sessionId, "assistant", JSON.stringify(feedback));

      return Response.json({ feedback, xpEarned: 0, score: 0 });
    }

    if (!answer) {
      return Response.json({ error: "Answer is required." }, { status: 400 });
    }

    const history = await getChatMessages(sessionId);
    const compactHistory = history.slice(-8).map((m) => `${m.role}: ${m.content}`).join("\n");

    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: getModelName(),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an interview evaluator. Return strict JSON with keys: score (1-10 number), strengths (string[]), missingPoints (string[]), improvements (string[]), summary (string), isCorrect (boolean)."
        },
        {
          role: "user",
          content: `Question: ${question.prompt}\nIdeal Answer: ${question.ideal_answer}\nKey Points: ${(question.key_points ?? []).join(", ")}\nRecent chat context:\n${compactHistory || "None"}\nCandidate Answer: ${answer}`
        }
      ],
      temperature: 0.2
    });

    const fallbackFeedback: EvaluationFeedback = {
      score: 5,
      strengths: ["You provided an answer."],
      missingPoints: ["Add more depth and concrete examples."],
      improvements: ["Use a clear structure: context, approach, result."],
      summary: "Reasonable first attempt. Expand and make it more structured.",
      isCorrect: false
    };

    const feedback = parseJson<EvaluationFeedback>(extractTextContent(completion.choices[0]?.message?.content), fallbackFeedback);

    const normalizedFeedback: EvaluationFeedback = {
      ...feedback,
      score: Math.min(10, Math.max(1, Number(feedback.score || 5))),
      strengths: Array.isArray(feedback.strengths) ? feedback.strengths : fallbackFeedback.strengths,
      missingPoints: Array.isArray(feedback.missingPoints) ? feedback.missingPoints : fallbackFeedback.missingPoints,
      improvements: Array.isArray(feedback.improvements) ? feedback.improvements : fallbackFeedback.improvements,
      summary: typeof feedback.summary === "string" ? feedback.summary : fallbackFeedback.summary,
      isCorrect: Boolean(feedback.isCorrect)
    };

    const xpEarned = await saveEvaluation({
      userId: auth.userId,
      dailyQuestionId: body.dailyQuestionId,
      answer,
      feedback: normalizedFeedback,
      difficulty: Number(question.difficulty) as 1 | 2 | 3 | 4 | 5,
      hintsUsed: record.hints_used ?? 0
    });

    await saveChatMessage(sessionId, "user", answer);
    await saveChatMessage(sessionId, "assistant", JSON.stringify(normalizedFeedback));

    return Response.json({ feedback: normalizedFeedback, xpEarned });
  } catch (error) {
    return unauthorizedResponse(error instanceof Error ? error.message : "Unauthorized");
  }
}
