import { NextRequest } from "next/server";
import { getAuthContext, routeErrorResponse } from "@/lib/auth";
import {
  assignNextDailyQuestion,
  ensureChatSession,
  ensureProfile,
  getChatMessages,
  getAnsweredQuestionsByTopic,
  getOrAssignDailyQuestions
} from "@/lib/db";
import { hoursUntilMidnight } from "@/lib/time";

function countCoachingTurns(messages: Array<{ role: string; content: string }>) {
  return messages.filter(
    (message) =>
      message.role === "user" &&
      !message.content.startsWith("Hint request") &&
      !message.content.startsWith("Submit attempt") &&
      !message.content.startsWith("I gave up")
  ).length;
}

async function buildDailyResponse(userId: string) {
  const result = await getOrAssignDailyQuestions(userId);
  const answeredByTopic = await getAnsweredQuestionsByTopic(userId);
  const withSessions = await Promise.all(
    result.questions.map(async (item) => {
      const chatSessionId = await ensureChatSession(userId, item.id);
      const messages = await getChatMessages(chatSessionId);
      return {
        ...item,
        chatSessionId,
        helpTurns: countCoachingTurns(messages)
      };
    })
  );

  return {
    day: result.day,
    timezone: result.timezone,
    hoursUntilUnlock: hoursUntilMidnight(result.timezone),
    questions: withSessions,
    answeredByTopic
  };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    await ensureProfile(auth.userId, auth.email);

    const response = await buildDailyResponse(auth.userId);
    return Response.json(response);
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    await ensureProfile(auth.userId, auth.email);

    const body = await req.json().catch(() => ({}));
    if (body?.action !== "next") {
      return Response.json({ error: "Only action=next is supported." }, { status: 400 });
    }
    const topicId = typeof body?.topicId === "string" && body.topicId.trim() ? body.topicId.trim() : undefined;

    const current = await buildDailyResponse(auth.userId);
    const hasOpenQuestion = current.questions.some((question) => !question.locked);

    if (hasOpenQuestion) {
      return Response.json(
        {
          ...current,
          added: false,
          addedQuestionId: null,
          message: "Complete current question first before unlocking the next one."
        },
        { status: 409 }
      );
    }

    const assignment = await assignNextDailyQuestion(auth.userId, topicId);
    const refreshed = await buildDailyResponse(auth.userId);

    return Response.json({
      ...refreshed,
      added: assignment.added,
      addedQuestionId: assignment.addedQuestionId,
      message: assignment.added
        ? "Next question unlocked."
        : "No more active questions left. Add more questions in Admin."
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
