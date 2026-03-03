import { NextRequest } from "next/server";
import { getAuthContext, routeErrorResponse } from "@/lib/auth";
import {
  ensureChatSession,
  incrementHint,
  saveChatMessage,
  saveEvaluation,
  saveGiveUp
} from "@/lib/db";
import { getChatMemoryContext, maybeRefreshChatSessionSummary } from "@/lib/chat-memory";
import { getModelName, getOpenAIClient } from "@/lib/openai";
import { getServiceClient } from "@/lib/supabase/server";
import { EvaluationFeedback, GiveUpFeedback } from "@/lib/types";

interface EvaluatePayload {
  action: "hint" | "submit" | "giveup";
  dailyQuestionId: string;
  answer?: string;
}

interface EvaluatorFeedback extends EvaluationFeedback {
  directMatch?: boolean;
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

function buildRetryHint(feedback: EvaluationFeedback) {
  const keyMiss = feedback.missingPoints?.[0];
  const keyImprove = feedback.improvements?.[0];

  if (keyMiss && keyImprove) {
    return `You are close. Fix this first: ${keyMiss} Then improve with: ${keyImprove}`;
  }
  if (keyMiss) {
    return `Focus on this missing point: ${keyMiss}`;
  }
  if (keyImprove) {
    return `Try this improvement next: ${keyImprove}`;
  }

  return "Refine your answer with clearer structure, concrete examples, and key trade-offs.";
}

function countCoachingTurns(messages: Array<{ role: string; content: string }>) {
  return messages.filter(
    (message) =>
      message.role === "user" &&
      !message.content.startsWith("Hint request") &&
      !message.content.startsWith("Submit attempt") &&
      !message.content.startsWith("I gave up")
  ).length;
}

async function generateFollowUpQuestion(params: {
  prompt: string;
  idealAnswer: string;
  candidateAnswer: string;
  keyPoints: string[];
}) {
  const { prompt, idealAnswer, candidateAnswer, keyPoints } = params;
  const openai = getOpenAIClient();

  try {
    const completion = await openai.chat.completions.create({
      model: getModelName(),
      messages: [
        {
          role: "system",
          content:
            "You are an interview coach. Return one concise follow-up interview question to deepen understanding."
        },
        {
          role: "user",
          content: `Original question: ${prompt}\nIdeal answer: ${idealAnswer}\nKey points: ${keyPoints.join(", ")}\nCandidate answer: ${candidateAnswer}`
        }
      ],
      temperature: 0.5
    });

    const question = extractTextContent(completion.choices[0]?.message?.content).trim();
    return question || "What trade-offs would you highlight if this solution had to scale 10x?";
  } catch {
    return "What trade-offs would you highlight if this solution had to scale 10x?";
  }
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
      .select("id, user_id, locked, hints_used, question:questions(topic_id, prompt, ideal_answer, key_points, difficulty)")
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
      const { sessionSummary, recentMessages } = await getChatMemoryContext(sessionId, 6);
      const openai = getOpenAIClient();
      const completion = await openai.chat.completions.create({
        model: getModelName(),
        messages: [
          {
            role: "system",
            content:
              "You are an interview coach. Give one concise hint that nudges the user forward without revealing the full answer."
          },
          ...(sessionSummary
            ? [
                {
                  role: "system" as const,
                  content: `Session memory summary:\n${sessionSummary}`
                }
              ]
            : []),
          ...recentMessages.map((message) => ({
            role: message.role as "user" | "assistant",
            content: message.content
          })),
          {
            role: "user",
            content: `Question: ${question.prompt}\nDraft Answer: ${answer || "No draft provided yet"}\nKey Points: ${(question.key_points ?? []).join(", ")}`
          }
        ],
        temperature: 0.4
      });

      const hint = extractTextContent(completion.choices[0]?.message?.content) ||
        "Focus on structuring your response into problem framing, approach, and trade-offs.";
      const hintsUsed = await incrementHint(body.dailyQuestionId);

      await saveChatMessage(sessionId, "user", `Hint request\n${answer}`);
      await saveChatMessage(sessionId, "assistant", hint);
      await maybeRefreshChatSessionSummary(sessionId);

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

      const giveUpResult = await saveGiveUp({
        userId: auth.userId,
        dailyQuestionId: body.dailyQuestionId,
        answer,
        feedback,
        difficulty: Number(question.difficulty) as 1 | 2 | 3 | 4 | 5,
        topicId: typeof question.topic_id === "string" ? question.topic_id : null,
        hintsUsed: record.hints_used ?? 0
      });

      await saveChatMessage(sessionId, "user", `I gave up. Draft answer:\n${answer || "No draft"}`);
      await saveChatMessage(sessionId, "assistant", JSON.stringify(feedback));
      await maybeRefreshChatSessionSummary(sessionId);

      return Response.json({
        feedback,
        xpEarned: giveUpResult.xpEarned,
        xpBreakdown: giveUpResult.xpBreakdown,
        missionsCompleted: giveUpResult.missionsCompleted,
        missionProgress: giveUpResult.missionProgress,
        achievementsUnlocked: giveUpResult.achievementsUnlocked,
        mastery: giveUpResult.mastery,
        score: 0
      });
    }

    if (!answer) {
      return Response.json({ error: "Answer is required." }, { status: 400 });
    }

    const { sessionSummary, recentMessages, allMessages } = await getChatMemoryContext(sessionId, 8);
    const compactHistory = recentMessages.map((m) => `${m.role}: ${m.content}`).join("\n");

    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: getModelName(),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an interview evaluator. Return strict JSON with keys: score (1-10 number), strengths (string[]), missingPoints (string[]), improvements (string[]), summary (string), isCorrect (boolean), directMatch (boolean). directMatch=true only when the candidate answer semantically matches the ideal answer very closely and covers key points."
        },
        ...(sessionSummary
          ? [
              {
                role: "system" as const,
                content: `Session memory summary:\n${sessionSummary}`
              }
            ]
          : []),
        {
          role: "user",
          content: `Question: ${question.prompt}\nIdeal Answer: ${question.ideal_answer}\nKey Points: ${(question.key_points ?? []).join(", ")}\nRecent chat context:\n${compactHistory || "None"}\nCandidate Answer: ${answer}`
        }
      ],
      temperature: 0.2
    });

    const fallbackFeedback: EvaluatorFeedback = {
      score: 5,
      strengths: ["You provided an answer."],
      missingPoints: ["Add more depth and concrete examples."],
      improvements: ["Use a clear structure: context, approach, result."],
      summary: "Reasonable first attempt. Expand and make it more structured.",
      isCorrect: false,
      directMatch: false
    };

    const feedback = parseJson<EvaluatorFeedback>(extractTextContent(completion.choices[0]?.message?.content), fallbackFeedback);

    let normalizedFeedback: EvaluatorFeedback = {
      ...feedback,
      score: Math.min(10, Math.max(1, Number(feedback.score || 5))),
      strengths: Array.isArray(feedback.strengths) ? feedback.strengths : fallbackFeedback.strengths,
      missingPoints: Array.isArray(feedback.missingPoints) ? feedback.missingPoints : fallbackFeedback.missingPoints,
      improvements: Array.isArray(feedback.improvements) ? feedback.improvements : fallbackFeedback.improvements,
      summary: typeof feedback.summary === "string" ? feedback.summary : fallbackFeedback.summary,
      isCorrect: Boolean(feedback.isCorrect),
      directMatch: Boolean(feedback.directMatch)
    };

    if (normalizedFeedback.directMatch) {
      normalizedFeedback = {
        ...normalizedFeedback,
        score: 10,
        isCorrect: true
      };
    }

    const needsRetry = !normalizedFeedback.isCorrect || normalizedFeedback.score < 7;
    if (needsRetry) {
      const retryHint = buildRetryHint(normalizedFeedback);
      const hintsUsed = await incrementHint(body.dailyQuestionId);

      await saveChatMessage(sessionId, "user", `Submit attempt\n${answer}`);
      await saveChatMessage(sessionId, "assistant", `Retry hint: ${retryHint}`);
      await maybeRefreshChatSessionSummary(sessionId);

      return Response.json({
        needsRetry: true,
        message: "Not fully correct yet. Improve using this hint and submit again.",
        hint: retryHint,
        hintsUsed,
        feedback: normalizedFeedback
      });
    }

    const helpTurns = countCoachingTurns(allMessages);
    const evaluationResult = await saveEvaluation({
      userId: auth.userId,
      dailyQuestionId: body.dailyQuestionId,
      answer,
      feedback: normalizedFeedback,
      difficulty: Number(question.difficulty) as 1 | 2 | 3 | 4 | 5,
      topicId: typeof question.topic_id === "string" ? question.topic_id : null,
      hintsUsed: record.hints_used ?? 0,
      helpTurns,
      directMatch: normalizedFeedback.directMatch
    });

    const followUpQuestion = await generateFollowUpQuestion({
      prompt: question.prompt,
      idealAnswer: question.ideal_answer,
      candidateAnswer: answer,
      keyPoints: Array.isArray(question.key_points) ? question.key_points : []
    });

    const cheer = normalizedFeedback.directMatch
      ? "Excellent. That answer closely matches the ideal structure."
      : "Good answer. You can sharpen it further with this follow-up.";

    await saveChatMessage(sessionId, "user", answer);
    await saveChatMessage(
      sessionId,
      "assistant",
      JSON.stringify({
        feedback: normalizedFeedback,
        cheer,
        followUpQuestion,
        xpEarned: evaluationResult.xpEarned,
        xpBreakdown: evaluationResult.xpBreakdown,
        missionsCompleted: evaluationResult.missionsCompleted,
        achievementsUnlocked: evaluationResult.achievementsUnlocked,
        mastery: evaluationResult.mastery
      })
    );
    await maybeRefreshChatSessionSummary(sessionId);

    return Response.json({
      feedback: normalizedFeedback,
      xpEarned: evaluationResult.xpEarned,
      xpBreakdown: evaluationResult.xpBreakdown,
      missionsCompleted: evaluationResult.missionsCompleted,
      missionProgress: evaluationResult.missionProgress,
      achievementsUnlocked: evaluationResult.achievementsUnlocked,
      mastery: evaluationResult.mastery,
      cheer,
      followUpQuestion,
      helpTurns
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
