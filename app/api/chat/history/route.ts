import { NextRequest } from "next/server";
import { getAuthContext, routeErrorResponse } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/server";

function isMissingPreviewColumns(error: { code?: string | null; message?: string | null } | null) {
  if (!error) {
    return false;
  }

  if (error.code === "PGRST204") {
    return true;
  }

  const message = error.message ?? "";
  return message.includes("last_message_preview") || message.includes("last_message_at");
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const supabase = getServiceClient();

    const sessionSelect =
      "id, daily_question_id, created_at, last_message_preview, last_message_at, daily_question:daily_questions(day, question:questions(prompt, topic:topics(name)))";
    const { data: sessions, error: sessionsError } = await supabase
      .from("chat_sessions")
      .select(sessionSelect)
      .eq("user_id", auth.userId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(100);

    if (sessionsError) {
      if (isMissingPreviewColumns(sessionsError)) {
        const { data: legacySessions, error: legacyError } = await supabase
          .from("chat_sessions")
          .select("id, daily_question_id, created_at, daily_question:daily_questions(day, question:questions(prompt, topic:topics(name)))")
          .eq("user_id", auth.userId)
          .order("created_at", { ascending: false })
          .limit(100);


        if (legacyError) {
          return Response.json({ error: legacyError.message }, { status: 500 });
        }

        const legacySessionIds = (legacySessions ?? []).map((session) => session.id).filter(Boolean);
        const latestMessageBySession = new Map<string, { content: string; created_at: string }>();
        await Promise.all(
          legacySessionIds.map(async (sessionId) => {
            const { data: latestRows } = await supabase
              .from("chat_messages")
              .select("content, created_at")
              .eq("session_id", sessionId)
              .order("created_at", { ascending: false })
              .limit(1);

            const latest = latestRows?.[0];
            if (latest) {
              latestMessageBySession.set(sessionId, {
                content: latest.content ?? "",
                created_at: latest.created_at ?? ""
              });
            }
          })
        );

        const payload = (legacySessions ?? [])
          .map((session) => {
            const dailyQuestion = Array.isArray(session.daily_question) ? session.daily_question[0] : session.daily_question;
            const question = Array.isArray(dailyQuestion?.question) ? dailyQuestion.question[0] : dailyQuestion?.question;
            const topic = Array.isArray(question?.topic) ? question.topic[0] : question?.topic;
            const latest = latestMessageBySession.get(session.id);

            return {
              sessionId: session.id,
              dailyQuestionId: session.daily_question_id,
              day: dailyQuestion?.day ?? "",
              topicName: topic?.name ?? "General",
              prompt: question?.prompt ?? "Untitled question",
              lastMessage: latest?.content ?? "",
              lastMessageAt: latest?.created_at ?? session.created_at
            };
          })
          .sort((a, b) => {
            if (a.lastMessageAt > b.lastMessageAt) return -1;
            if (a.lastMessageAt < b.lastMessageAt) return 1;
            return 0;
          });

        return Response.json({ sessions: payload });
      }

      return Response.json({ error: sessionsError.message }, { status: 500 });
    }

    const payload = (sessions ?? []).map((session) => {
      const dailyQuestion = Array.isArray(session.daily_question) ? session.daily_question[0] : session.daily_question;
      const question = Array.isArray(dailyQuestion?.question) ? dailyQuestion.question[0] : dailyQuestion?.question;
      const topic = Array.isArray(question?.topic) ? question.topic[0] : question?.topic;
      const preview = typeof session.last_message_preview === "string" ? session.last_message_preview : "";
      const previewAt = typeof session.last_message_at === "string" ? session.last_message_at : session.created_at;

      return {
        sessionId: session.id,
        dailyQuestionId: session.daily_question_id,
        day: dailyQuestion?.day ?? "",
        topicName: topic?.name ?? "General",
        prompt: question?.prompt ?? "Untitled question",
        lastMessage: preview,
        lastMessageAt: previewAt
      };
    });

    return Response.json({ sessions: payload });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
