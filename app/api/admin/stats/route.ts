import { NextRequest } from "next/server";
import { forbiddenResponse, getAuthContext, routeErrorResponse } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);

    if (!auth.isAdmin) {
      return forbiddenResponse();
    }

    const supabase = getServiceClient();

    const [{ count: totalQuestions }, { count: totalUsers }, { data: scores }] = await Promise.all([
      supabase.from("questions").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("daily_questions").select("ai_score").not("ai_score", "is", null)
    ]);

    const scoreList = (scores ?? []).map((row) => Number(row.ai_score)).filter((value) => Number.isFinite(value));
    const averageScore = scoreList.length
      ? Number((scoreList.reduce((sum, value) => sum + value, 0) / scoreList.length).toFixed(2))
      : 0;

    return Response.json({
      totalQuestions: totalQuestions ?? 0,
      totalUsers: totalUsers ?? 0,
      averageScore
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
