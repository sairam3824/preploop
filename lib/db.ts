import { getServiceClient } from "@/lib/supabase/server";
import { calculateLevel, calculateXp } from "@/lib/gamification";
import { getDayInTimezone, updateStreak } from "@/lib/time";
import { DailyQuestion, Difficulty, EvaluationFeedback, GiveUpFeedback } from "@/lib/types";

export async function ensureProfile(userId: string, email: string, timezone?: string) {
  const supabase = getServiceClient();
  const safeTimezone = timezone && timezone.trim() ? timezone : "UTC";

  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (existing) {
    return;
  }

  const { error } = await supabase.from("profiles").insert({
    id: userId,
    email,
    timezone: safeTimezone,
    level: "Beginner"
  });

  if (error) {
    throw new Error(`Failed to create profile: ${error.message}`);
  }
}

export async function getOrAssignDailyQuestions(userId: string) {
  const supabase = getServiceClient();

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .single();

  if (profileError) {
    throw new Error(`Failed to load profile: ${profileError.message}`);
  }

  const timezone = profile?.timezone ?? "UTC";
  const today = getDayInTimezone(timezone);

  const { data: existing, error: existingError } = await supabase
    .from("daily_questions")
    .select("*, question:questions(*, topic:topics(*))")
    .eq("user_id", userId)
    .eq("day", today)
    .order("created_at", { ascending: true });

  if (existingError) {
    throw new Error(`Failed to load daily questions: ${existingError.message}`);
  }

  if (existing && existing.length > 0) {
    return { questions: existing as DailyQuestion[], day: today, timezone };
  }

  const count = Math.random() < 0.55 ? 1 : 2;

  const { data: allQuestions, error: questionError } = await supabase
    .from("questions")
    .select("id")
    .eq("active", true);

  if (questionError) {
    throw new Error(`Failed to load questions: ${questionError.message}`);
  }

  if (!allQuestions || allQuestions.length === 0) {
    return { questions: [], day: today, timezone };
  }

  const shuffled = [...allQuestions].sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, Math.min(count, shuffled.length)).map((q) => ({
    user_id: userId,
    question_id: q.id,
    day: today,
    unlocked_at: new Date().toISOString(),
    locked: false,
    hints_used: 0,
    xp_earned: 0,
    gave_up: false
  }));

  const { error: insertError } = await supabase.from("daily_questions").insert(picked);

  if (insertError) {
    throw new Error(`Failed to assign daily questions: ${insertError.message}`);
  }

  const { data: assigned, error: assignedError } = await supabase
    .from("daily_questions")
    .select("*, question:questions(*, topic:topics(*))")
    .eq("user_id", userId)
    .eq("day", today)
    .order("created_at", { ascending: true });

  if (assignedError) {
    throw new Error(`Failed to reload assigned questions: ${assignedError.message}`);
  }

  return { questions: (assigned ?? []) as DailyQuestion[], day: today, timezone };
}

export async function incrementHint(dailyQuestionId: string) {
  const supabase = getServiceClient();
  const { data: record, error: readError } = await supabase
    .from("daily_questions")
    .select("hints_used")
    .eq("id", dailyQuestionId)
    .single();

  if (readError) {
    throw new Error(`Failed to load hint count: ${readError.message}`);
  }

  const hintsUsed = (record?.hints_used ?? 0) + 1;

  const { error: updateError } = await supabase
    .from("daily_questions")
    .update({ hints_used: hintsUsed })
    .eq("id", dailyQuestionId);

  if (updateError) {
    throw new Error(`Failed to update hint count: ${updateError.message}`);
  }

  return hintsUsed;
}

export async function saveEvaluation(params: {
  userId: string;
  dailyQuestionId: string;
  answer: string;
  feedback: EvaluationFeedback;
  difficulty: Difficulty;
  hintsUsed: number;
}) {
  const { userId, dailyQuestionId, answer, feedback, difficulty, hintsUsed } = params;
  const supabase = getServiceClient();

  const xpEarned = calculateXp({
    difficulty,
    score: feedback.score,
    hintsUsed,
    gaveUp: false
  });

  const { data: updatedRows, error: updateError } = await supabase
    .from("daily_questions")
    .update({
      user_answer: answer,
      ai_score: Math.round(feedback.score),
      ai_feedback: feedback,
      attempted_at: new Date().toISOString(),
      locked: true,
      xp_earned: xpEarned,
      gave_up: false
    })
    .eq("id", dailyQuestionId)
    .eq("user_id", userId)
    .eq("locked", false)
    .select("id");

  if (updateError) {
    throw new Error(`Failed to save evaluation: ${updateError.message}`);
  }
  if (!updatedRows || updatedRows.length === 0) {
    throw new Error("Question was already locked and could not be updated.");
  }

  await updateProfileStats(userId, xpEarned, feedback.score >= 7);

  return xpEarned;
}

export async function saveGiveUp(params: {
  userId: string;
  dailyQuestionId: string;
  answer: string;
  feedback: GiveUpFeedback;
}) {
  const { userId, dailyQuestionId, answer, feedback } = params;
  const supabase = getServiceClient();

  const { data: updatedRows, error } = await supabase
    .from("daily_questions")
    .update({
      user_answer: answer,
      ai_feedback: feedback,
      attempted_at: new Date().toISOString(),
      locked: true,
      gave_up: true,
      xp_earned: 0,
      ai_score: 0
    })
    .eq("id", dailyQuestionId)
    .eq("user_id", userId)
    .eq("locked", false)
    .select("id");

  if (error) {
    throw new Error(`Failed to store give-up result: ${error.message}`);
  }
  if (!updatedRows || updatedRows.length === 0) {
    throw new Error("Question was already locked and could not be updated.");
  }

  await updateProfileStats(userId, 0, false);
}

export async function updateProfileStats(userId: string, xpGain: number, correct: boolean) {
  const supabase = getServiceClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("xp, total_questions, correct_answers, streak_count, last_active_date, timezone")
    .eq("id", userId)
    .single();

  if (error) {
    throw new Error(`Failed to read profile for stats: ${error.message}`);
  }

  const today = getDayInTimezone(profile?.timezone ?? "UTC");
  const newXp = (profile?.xp ?? 0) + xpGain;
  const totalQuestions = (profile?.total_questions ?? 0) + 1;
  const correctAnswers = (profile?.correct_answers ?? 0) + (correct ? 1 : 0);
  const streak = updateStreak(profile?.last_active_date ?? null, today, profile?.streak_count ?? 0);

  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      xp: newXp,
      total_questions: totalQuestions,
      correct_answers: correctAnswers,
      streak_count: streak,
      last_active_date: today,
      level: calculateLevel(newXp),
      updated_at: new Date().toISOString()
    })
    .eq("id", userId);

  if (updateError) {
    throw new Error(`Failed to update profile stats: ${updateError.message}`);
  }

  const { data: averageData } = await supabase
    .from("daily_questions")
    .select("ai_score")
    .eq("user_id", userId)
    .not("attempted_at", "is", null);

  const scores = (averageData ?? [])
    .map((row) => Number(row.ai_score))
    .filter((score) => Number.isFinite(score));

  const averageScore = scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : 0;
  const accuracy = totalQuestions === 0 ? 0 : Math.round((correctAnswers / totalQuestions) * 100);

  await supabase.from("performance_history").upsert(
    {
      user_id: userId,
      day: today,
      total_xp: newXp,
      average_score: averageScore,
      accuracy_pct: accuracy,
      streak
    },
    { onConflict: "user_id,day" }
  );
}

export async function ensureChatSession(userId: string, dailyQuestionId: string) {
  const supabase = getServiceClient();
  const { data: existing, error: existingError } = await supabase
    .from("chat_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("daily_question_id", dailyQuestionId)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to load chat session: ${existingError.message}`);
  }

  if (existing?.id) {
    return existing.id;
  }

  const { data: created, error: createError } = await supabase
    .from("chat_sessions")
    .insert({ user_id: userId, daily_question_id: dailyQuestionId, status: "active" })
    .select("id")
    .single();

  if (createError || !created?.id) {
    throw new Error(`Failed to create chat session: ${createError?.message ?? "Unknown error"}`);
  }

  return created.id;
}

export async function saveChatMessage(sessionId: string, role: "user" | "assistant", content: string) {
  const supabase = getServiceClient();
  const { error } = await supabase.from("chat_messages").insert({
    session_id: sessionId,
    role,
    content
  });

  if (error) {
    throw new Error(`Failed to save chat message: ${error.message}`);
  }
}

export async function getChatMessages(sessionId: string) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load chat messages: ${error.message}`);
  }

  return data ?? [];
}
