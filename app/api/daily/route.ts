import { NextRequest } from "next/server";
import { getAuthContext, unauthorizedResponse } from "@/lib/auth";
import { ensureChatSession, ensureProfile, getOrAssignDailyQuestions } from "@/lib/db";
import { hoursUntilMidnight } from "@/lib/time";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    await ensureProfile(auth.userId, auth.email, req.headers.get("x-user-timezone") ?? undefined);

    const result = await getOrAssignDailyQuestions(auth.userId);
    const withSessions = await Promise.all(
      result.questions.map(async (item) => ({
        ...item,
        chatSessionId: await ensureChatSession(auth.userId, item.id)
      }))
    );

    return Response.json({
      day: result.day,
      timezone: result.timezone,
      hoursUntilUnlock: hoursUntilMidnight(result.timezone),
      questions: withSessions
    });
  } catch (error) {
    return unauthorizedResponse(error instanceof Error ? error.message : "Unauthorized");
  }
}
