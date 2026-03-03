import { NextRequest } from "next/server";
import { getAuthContext, routeErrorResponse } from "@/lib/auth";
import { getGamificationSnapshot } from "@/lib/db";
import { getServiceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const supabase = getServiceClient();

    const [{ data: profile }, { data: history }, { data: topicStats }, gamification] = await Promise.all([
      supabase.from("profiles").select("xp, level, streak_count, total_questions, correct_answers").eq("id", auth.userId).single(),
      supabase
        .from("performance_history")
        .select("day, average_score, accuracy_pct, streak, total_xp")
        .eq("user_id", auth.userId)
        .order("day", { ascending: true }),
      supabase
        .from("daily_questions")
        .select("ai_score, question:questions(topic_id, topic:topics(name))")
        .eq("user_id", auth.userId)
        .not("ai_score", "is", null),
      getGamificationSnapshot(auth.userId)
    ]);

    const topicMap = new Map<string, { topicName: string; total: number; scoreSum: number }>();

    for (const row of topicStats ?? []) {
      const question = (Array.isArray(row.question) ? row.question[0] : row.question) as
        | {
            topic_id?: string | null;
            topic?: { name?: string | null } | Array<{ name?: string | null }> | null;
          }
        | null
        | undefined;
      const topicId = question?.topic_id;
      const topicName = Array.isArray(question?.topic) ? question.topic[0]?.name : question?.topic?.name;

      if (!topicId) {
        continue;
      }

      const item = topicMap.get(topicId) ?? { topicName: topicName ?? "General", total: 0, scoreSum: 0 };
      item.total += 1;
      item.scoreSum += Number(row.ai_score) || 0;
      topicMap.set(topicId, item);
    }

    const progress = Array.from(topicMap.values()).map((item) => ({
      topicName: item.topicName,
      answered: item.total,
      avgScore: Number((item.scoreSum / item.total).toFixed(2)),
      progressPct: Math.min(100, item.total * 10)
    }));

    return Response.json({
      profile,
      history: history ?? [],
      topicProgress: progress,
      gamification
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
