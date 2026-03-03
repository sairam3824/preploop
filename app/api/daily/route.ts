import { NextRequest } from "next/server";
import { getAuthContext, unauthorizedResponse } from "@/lib/auth";
import {
  assignNextDailyQuestion,
  ensureChatSession,
  ensureProfile,
  getAnsweredQuestionsByTopic,
  getOrAssignDailyQuestions
} from "@/lib/db";
import { hoursUntilMidnight } from "@/lib/time";

async function buildDailyResponse(userId: string) {
  const result = await getOrAssignDailyQuestions(userId);
  const answeredByTopic = await getAnsweredQuestionsByTopic(userId);
  const withSessions = await Promise.all(
    result.questions.map(async (item) => ({
      ...item,
      chatSessionId: await ensureChatSession(userId, item.id)
    }))
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
    await ensureProfile(auth.userId, auth.email, req.headers.get("x-user-timezone") ?? undefined);

    const response = await buildDailyResponse(auth.userId);
    return Response.json(response);
  } catch (error) {
    return unauthorizedResponse(error instanceof Error ? error.message : "Unauthorized");
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    await ensureProfile(auth.userId, auth.email, req.headers.get("x-user-timezone") ?? undefined);

    const body = await req.json().catch(() => ({}));
    if (body?.action !== "next") {
      return Response.json({ error: "Only action=next is supported." }, { status: 400 });
    }

    const assignment = await assignNextDailyQuestion(auth.userId);
    const answeredByTopic = await getAnsweredQuestionsByTopic(auth.userId);
    const withSessions = await Promise.all(
      assignment.questions.map(async (item) => ({
        ...item,
        chatSessionId: await ensureChatSession(auth.userId, item.id)
      }))
    );

    return Response.json({
      day: assignment.day,
      timezone: assignment.timezone,
      hoursUntilUnlock: hoursUntilMidnight(assignment.timezone),
      questions: withSessions,
      answeredByTopic,
      added: assignment.added,
      addedQuestionId: assignment.addedQuestionId,
      message: assignment.added
        ? "Next question unlocked."
        : "No more active questions left. Add more questions in Admin."
    });
  } catch (error) {
    return unauthorizedResponse(error instanceof Error ? error.message : "Unauthorized");
  }
}
