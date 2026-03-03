import { getServiceClient } from "@/lib/supabase/server";
import {
  calculateLevel,
  calculateMasteryScore,
  calculateXp,
  calculateXpBreakdown,
  getMissionPeriod,
  recommendDifficulty,
  XpBreakdown
} from "@/lib/gamification";
import { APP_TIMEZONE, getDayInTimezone, updateStreak } from "@/lib/time";
import {
  DailyQuestion,
  Difficulty,
  EvaluationFeedback,
  GiveUpFeedback,
  Mission,
  TopicMastery,
  UserAchievement,
  UserMissionProgress
} from "@/lib/types";

type MissionMetric = "complete_questions" | "correct_answers" | "no_hint_wins" | "direct_matches" | "topic_diversity";

interface MissionProgressItem {
  missionId: string;
  code: string;
  name: string;
  description: string;
  scope: "daily" | "weekly";
  metric: MissionMetric;
  target: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
  xpReward: number;
  periodStart: string;
  periodEnd: string;
}

interface AchievementUnlock {
  code: string;
  name: string;
  description: string;
  xpReward: number;
  unlockedAt: string;
}

interface ProfileStatUpdate {
  today: string;
  xp: number;
  level: string;
  streak: number;
  streakFreezes: number;
  freezeConsumed: boolean;
}

interface ProgressEventInput {
  userId: string;
  today: string;
  topicId: string | null;
  difficulty: Difficulty;
  score: number;
  isCorrect: boolean;
  directMatch: boolean;
  hintsUsed: number;
  gaveUp: boolean;
}

interface AchievementRow {
  id: string;
  code: string;
  name: string;
  description: string;
  category: "streak" | "accuracy" | "xp" | "direct_match" | "mastery";
  threshold: number;
  xp_reward: number;
  active: boolean;
}

export async function ensureProfile(userId: string, email: string, _timezone?: string) {
  const supabase = getServiceClient();
  const safeTimezone = APP_TIMEZONE;

  const { data: existing } = await supabase
    .from("profiles")
    .select("id, timezone")
    .eq("id", userId)
    .maybeSingle();

  if (existing) {
    if (existing.timezone !== APP_TIMEZONE) {
      const { error: timezoneError } = await supabase
        .from("profiles")
        .update({ timezone: APP_TIMEZONE, updated_at: new Date().toISOString() })
        .eq("id", userId);

      if (timezoneError) {
        throw new Error(`Failed to normalize profile timezone: ${timezoneError.message}`);
      }
    }
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
  const { timezone, today } = await getUserDayContext(userId);
  let existing = await loadDailyQuestionsForDay(userId, today);

  if (existing.length === 0) {
    await assignNextQuestionForUserDay(userId, today);
    existing = await loadDailyQuestionsForDay(userId, today);
  }

  return { questions: existing, day: today, timezone };
}

export async function assignNextDailyQuestion(userId: string, topicId?: string) {
  const { timezone, today } = await getUserDayContext(userId);
  const addedQuestion = await assignNextQuestionForUserDay(userId, today, topicId);
  const questions = await loadDailyQuestionsForDay(userId, today);

  return {
    questions,
    day: today,
    timezone,
    added: Boolean(addedQuestion),
    addedQuestionId: addedQuestion?.id ?? null
  };
}

async function getUserDayContext(userId: string) {
  return { timezone: APP_TIMEZONE, today: getDayInTimezone(APP_TIMEZONE) };
}

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dayToUtcDate(day: string) {
  return new Date(`${day}T00:00:00.000Z`);
}

function getWeekStart(day: string) {
  const base = dayToUtcDate(day);
  const weekday = base.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = new Date(base);
  monday.setUTCDate(base.getUTCDate() + mondayOffset);
  return toDateOnly(monday);
}

async function loadDailyQuestionsForDay(userId: string, day: string) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("daily_questions")
    .select("*, question:questions(*, topic:topics(*))")
    .eq("user_id", userId)
    .eq("day", day)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load daily questions: ${error.message}`);
  }

  return (data ?? []) as DailyQuestion[];
}

async function assignNextQuestionForUserDay(userId: string, day: string, topicId?: string) {
  const supabase = getServiceClient();
  const { data: assignedRows, error: assignedError } = await supabase
    .from("daily_questions")
    .select("question_id")
    .eq("user_id", userId);

  if (assignedError) {
    throw new Error(`Failed to load assigned questions: ${assignedError.message}`);
  }

  const assignedIds = new Set(
    (assignedRows ?? [])
      .map((row) => row.question_id)
      .filter((questionId): questionId is string => typeof questionId === "string" && questionId.length > 0)
  );

  let questionQuery = supabase
    .from("questions")
    .select("id")
    .eq("active", true)
    .order("question_number", { ascending: true })
    .order("created_at", { ascending: true });

  if (topicId && topicId.trim()) {
    questionQuery = questionQuery.eq("topic_id", topicId.trim());
  }

  const { data: availableQuestions, error: questionError } = await questionQuery;

  if (questionError) {
    throw new Error(`Failed to load questions: ${questionError.message}`);
  }

  const nextQuestion = (availableQuestions ?? []).find((question) => !assignedIds.has(question.id));
  if (!nextQuestion?.id) {
    return null;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("daily_questions")
    .insert({
      user_id: userId,
      question_id: nextQuestion.id,
      day,
      unlocked_at: new Date().toISOString(),
      locked: false,
      hints_used: 0,
      xp_earned: 0,
      gave_up: false
    })
    .select("*, question:questions(*, topic:topics(*))")
    .single();

  if (insertError) {
    throw new Error(`Failed to assign next question: ${insertError.message}`);
  }

  return inserted as DailyQuestion;
}

export async function getAnsweredQuestionsByTopic(userId: string) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("daily_questions")
    .select("id, day, ai_score, xp_earned, gave_up, question:questions(question_number, prompt, topic:topics(name))")
    .eq("user_id", userId)
    .eq("locked", true)
    .order("attempted_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load answered questions: ${error.message}`);
  }

  const grouped = new Map<
    string,
    Array<{
      id: string;
      day: string;
      questionNumber: number;
      prompt: string;
      score: number | null;
      xpEarned: number;
      gaveUp: boolean;
    }>
  >();

  for (const row of data ?? []) {
    const question = Array.isArray(row.question) ? row.question[0] : row.question;
    const topic = Array.isArray(question?.topic) ? question.topic[0] : question?.topic;
    const topicName = topic?.name ?? "General";
    const topicRows = grouped.get(topicName) ?? [];

    topicRows.push({
      id: row.id,
      day: row.day,
      questionNumber: Math.max(1, Number(question?.question_number) || 1),
      prompt: typeof question?.prompt === "string" ? question.prompt : "Untitled question",
      score: row.ai_score === null ? null : Number(row.ai_score),
      xpEarned: Number(row.xp_earned) || 0,
      gaveUp: Boolean(row.gave_up)
    });

    grouped.set(topicName, topicRows);
  }

  return Array.from(grouped.entries())
    .map(([topicName, questions]) => ({
      topicName,
      questions: questions.sort((a, b) => a.questionNumber - b.questionNumber)
    }))
    .sort((a, b) => a.topicName.localeCompare(b.topicName));
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
  topicId?: string | null;
  hintsUsed: number;
  helpTurns: number;
  directMatch?: boolean;
}) {
  const { userId, dailyQuestionId, answer, feedback, difficulty, topicId, hintsUsed, helpTurns, directMatch } = params;
  const supabase = getServiceClient();

  const coreXp = calculateXp({
    difficulty,
    score: feedback.score,
    hintsUsed,
    helpTurns,
    directMatch,
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
      xp_earned: coreXp,
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

  const profileStats = await updateProfileStats(userId, coreXp, feedback.score >= 7);

  const mastery = await updateTopicMastery({
    userId,
    topicId: topicId ?? null,
    difficulty,
    score: feedback.score,
    isCorrect: feedback.score >= 7,
    directMatch: Boolean(directMatch),
    hintsUsed,
    gaveUp: false
  });

  const missionOutcome = await applyMissionProgress({
    userId,
    today: profileStats.today,
    topicId: topicId ?? null,
    difficulty,
    score: feedback.score,
    isCorrect: feedback.score >= 7,
    directMatch: Boolean(directMatch),
    hintsUsed,
    gaveUp: false
  });

  if (missionOutcome.bonusXp > 0) {
    await applyProfileXpBonus(userId, missionOutcome.bonusXp);
  }

  const achievementOutcome = await unlockAchievements(userId);
  if (achievementOutcome.bonusXp > 0) {
    await applyProfileXpBonus(userId, achievementOutcome.bonusXp);
  }

  const finalXp = coreXp + missionOutcome.bonusXp + achievementOutcome.bonusXp;
  const xpBreakdown = calculateXpBreakdown({
    difficulty,
    score: feedback.score,
    hintsUsed,
    helpTurns,
    directMatch,
    gaveUp: false,
    missionBonus: missionOutcome.bonusXp,
    achievementBonus: achievementOutcome.bonusXp
  });

  const { error: xpUpdateError } = await supabase
    .from("daily_questions")
    .update({
      xp_earned: finalXp
    })
    .eq("id", dailyQuestionId)
    .eq("user_id", userId);

  if (xpUpdateError) {
    throw new Error(`Failed to update final XP: ${xpUpdateError.message}`);
  }

  return {
    xpEarned: finalXp,
    xpBreakdown,
    missionsCompleted: missionOutcome.completed,
    missionProgress: missionOutcome.missions,
    achievementsUnlocked: achievementOutcome.unlocked,
    mastery
  };
}

export async function saveGiveUp(params: {
  userId: string;
  dailyQuestionId: string;
  answer: string;
  feedback: GiveUpFeedback;
  difficulty: Difficulty;
  topicId?: string | null;
  hintsUsed?: number;
}) {
  const { userId, dailyQuestionId, answer, feedback, difficulty, topicId, hintsUsed = 0 } = params;
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

  const profileStats = await updateProfileStats(userId, 0, false);

  const mastery = await updateTopicMastery({
    userId,
    topicId: topicId ?? null,
    difficulty,
    score: 0,
    isCorrect: false,
    directMatch: false,
    hintsUsed,
    gaveUp: true
  });

  const missionOutcome = await applyMissionProgress({
    userId,
    today: profileStats.today,
    topicId: topicId ?? null,
    difficulty,
    score: 0,
    isCorrect: false,
    directMatch: false,
    hintsUsed,
    gaveUp: true
  });

  if (missionOutcome.bonusXp > 0) {
    await applyProfileXpBonus(userId, missionOutcome.bonusXp);
  }

  const achievementOutcome = await unlockAchievements(userId);
  if (achievementOutcome.bonusXp > 0) {
    await applyProfileXpBonus(userId, achievementOutcome.bonusXp);
  }

  const bonusXp = missionOutcome.bonusXp + achievementOutcome.bonusXp;
  if (bonusXp > 0) {
    const { error: xpUpdateError } = await supabase
      .from("daily_questions")
      .update({
        xp_earned: bonusXp
      })
      .eq("id", dailyQuestionId)
      .eq("user_id", userId);

    if (xpUpdateError) {
      throw new Error(`Failed to update give-up XP: ${xpUpdateError.message}`);
    }
  }

  return {
    xpEarned: bonusXp,
    xpBreakdown: calculateXpBreakdown({
      difficulty,
      score: 0,
      hintsUsed,
      helpTurns: 0,
      directMatch: false,
      gaveUp: true,
      missionBonus: missionOutcome.bonusXp,
      achievementBonus: achievementOutcome.bonusXp
    }),
    missionsCompleted: missionOutcome.completed,
    missionProgress: missionOutcome.missions,
    achievementsUnlocked: achievementOutcome.unlocked,
    mastery
  };
}

export async function updateProfileStats(userId: string, xpGain: number, correct: boolean) {
  const supabase = getServiceClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("xp, total_questions, correct_answers, streak_count, last_active_date, streak_freezes, last_freeze_grant_date")
    .eq("id", userId)
    .single();

  if (error) {
    throw new Error(`Failed to read profile for stats: ${error.message}`);
  }

  const today = getDayInTimezone(APP_TIMEZONE);
  const newXp = (profile?.xp ?? 0) + Math.max(0, xpGain);
  const totalQuestions = (profile?.total_questions ?? 0) + 1;
  const correctAnswers = (profile?.correct_answers ?? 0) + (correct ? 1 : 0);
  const todayWeekStart = getWeekStart(today);
  const grantDate = typeof profile?.last_freeze_grant_date === "string" ? profile.last_freeze_grant_date : null;
  let streakFreezes = Number(profile?.streak_freezes) || 0;
  let nextGrantDate = grantDate;

  if (!grantDate || grantDate < todayWeekStart) {
    streakFreezes = Math.min(2, streakFreezes + 1);
    nextGrantDate = today;
  }

  let freezeConsumed = false;
  let streak = updateStreak(profile?.last_active_date ?? null, today, profile?.streak_count ?? 0);
  if (profile?.last_active_date && profile.last_active_date !== today) {
    const last = dayToUtcDate(profile.last_active_date);
    const now = dayToUtcDate(today);
    const diffDays = Math.round((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays > 1 && streakFreezes > 0) {
      freezeConsumed = true;
      streakFreezes -= 1;
      streak = (profile?.streak_count ?? 0) + 1;
    }
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      xp: newXp,
      total_questions: totalQuestions,
      correct_answers: correctAnswers,
      streak_count: streak,
      streak_freezes: streakFreezes,
      last_freeze_grant_date: nextGrantDate,
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

  return {
    today,
    xp: newXp,
    level: calculateLevel(newXp),
    streak,
    streakFreezes,
    freezeConsumed
  } satisfies ProfileStatUpdate;
}

async function applyProfileXpBonus(userId: string, xpBonus: number) {
  if (xpBonus <= 0) {
    return;
  }

  const supabase = getServiceClient();
  const { data: profile, error: readError } = await supabase
    .from("profiles")
    .select("xp")
    .eq("id", userId)
    .single();

  if (readError) {
    throw new Error(`Failed to read profile XP bonus: ${readError.message}`);
  }

  const newXp = (Number(profile?.xp) || 0) + xpBonus;
  const { error } = await supabase
    .from("profiles")
    .update({
      xp: newXp,
      level: calculateLevel(newXp),
      updated_at: new Date().toISOString()
    })
    .eq("id", userId);

  if (error) {
    throw new Error(`Failed to apply profile XP bonus: ${error.message}`);
  }
}

async function updateTopicMastery(params: {
  userId: string;
  topicId: string | null;
  difficulty: Difficulty;
  score: number;
  isCorrect: boolean;
  directMatch: boolean;
  hintsUsed: number;
  gaveUp: boolean;
}) {
  const { userId, topicId, difficulty, score, isCorrect, directMatch, hintsUsed, gaveUp } = params;

  if (!topicId) {
    return null;
  }

  const supabase = getServiceClient();
  const { data: current, error: readError } = await supabase
    .from("topic_mastery")
    .select("id, mastery_score, attempts, correct_attempts")
    .eq("user_id", userId)
    .eq("topic_id", topicId)
    .maybeSingle();

  if (readError && readError.code !== "PGRST116") {
    throw new Error(`Failed to read topic mastery: ${readError.message}`);
  }

  const currentScore = Number(current?.mastery_score) || 0;
  const nextScore = calculateMasteryScore({
    currentScore,
    score,
    difficulty,
    directMatch,
    gaveUp,
    hintsUsed
  });

  const attempts = (Number(current?.attempts) || 0) + 1;
  const correctAttempts = (Number(current?.correct_attempts) || 0) + (isCorrect ? 1 : 0);

  const payload = {
    user_id: userId,
    topic_id: topicId,
    mastery_score: nextScore,
    attempts,
    correct_attempts: correctAttempts,
    last_score: Math.round(score),
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase.from("topic_mastery").upsert(payload, { onConflict: "user_id,topic_id" });
  if (error) {
    throw new Error(`Failed to update topic mastery: ${error.message}`);
  }

  return {
    topicId,
    masteryScore: nextScore,
    attempts,
    correctAttempts
  };
}

async function readOrCreateMissionProgress(params: {
  userId: string;
  mission: Mission;
  today: string;
}) {
  const { userId, mission, today } = params;
  const supabase = getServiceClient();
  const period = getMissionPeriod(mission.scope, dayToUtcDate(today));

  const { data: existing, error: readError } = await supabase
    .from("user_mission_progress")
    .select("*")
    .eq("user_id", userId)
    .eq("mission_id", mission.id)
    .eq("period_start", period.periodStart)
    .maybeSingle();

  if (readError && readError.code !== "PGRST116") {
    throw new Error(`Failed to load mission progress: ${readError.message}`);
  }

  if (existing) {
    return existing as UserMissionProgress;
  }

  const { data: created, error: createError } = await supabase
    .from("user_mission_progress")
    .insert({
      user_id: userId,
      mission_id: mission.id,
      period_start: period.periodStart,
      period_end: period.periodEnd,
      progress: 0,
      completed: false,
      claimed: false
    })
    .select("*")
    .single();

  if (createError || !created) {
    throw new Error(`Failed to create mission progress: ${createError?.message ?? "Unknown error"}`);
  }

  return created as UserMissionProgress;
}

async function computeTopicDiversity(userId: string, periodStart: string, periodEnd: string) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("daily_questions")
    .select("question:questions(topic_id)")
    .eq("user_id", userId)
    .not("attempted_at", "is", null)
    .gte("day", periodStart)
    .lte("day", periodEnd);

  if (error) {
    throw new Error(`Failed to compute topic diversity: ${error.message}`);
  }

  const topicIds = new Set<string>();
  for (const row of data ?? []) {
    const question = Array.isArray(row.question) ? row.question[0] : row.question;
    const topicId = typeof question?.topic_id === "string" ? question.topic_id : "";
    if (topicId) {
      topicIds.add(topicId);
    }
  }

  return topicIds.size;
}

async function applyMissionProgress(input: ProgressEventInput) {
  const { userId, today, isCorrect, directMatch, hintsUsed, gaveUp } = input;
  const supabase = getServiceClient();
  const { data: missionRows, error: missionError } = await supabase.from("missions").select("*").eq("active", true);
  if (missionError) {
    throw new Error(`Failed to load missions: ${missionError.message}`);
  }

  const missions = (missionRows ?? []) as Mission[];
  const missionItems: MissionProgressItem[] = [];
  const completed: MissionProgressItem[] = [];
  let bonusXp = 0;

  for (const mission of missions) {
    const progressRow = await readOrCreateMissionProgress({ userId, mission, today });
    let progress = Number(progressRow.progress) || 0;

    if (mission.metric === "complete_questions") {
      if (isCorrect || gaveUp) progress += 1;
    } else if (mission.metric === "correct_answers") {
      if (isCorrect) progress += 1;
    } else if (mission.metric === "no_hint_wins") {
      if (isCorrect && hintsUsed === 0) progress += 1;
    } else if (mission.metric === "direct_matches") {
      if (isCorrect && directMatch) progress += 1;
    } else if (mission.metric === "topic_diversity") {
      progress = await computeTopicDiversity(userId, progressRow.period_start, progressRow.period_end);
    }

    progress = Math.max(0, progress);
    const completedNow = progress >= mission.target;
    const justCompleted = completedNow && !progressRow.completed;

    const nextClaimed = progressRow.claimed || justCompleted;
    const payload = {
      progress,
      completed: completedNow,
      claimed: nextClaimed,
      completed_at: completedNow ? progressRow.completed_at ?? new Date().toISOString() : null,
      claimed_at: nextClaimed ? progressRow.claimed_at ?? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    };

    const { error: updateError } = await supabase
      .from("user_mission_progress")
      .update(payload)
      .eq("id", progressRow.id);

    if (updateError) {
      throw new Error(`Failed to update mission progress: ${updateError.message}`);
    }

    const missionItem: MissionProgressItem = {
      missionId: mission.id,
      code: mission.code,
      name: mission.name,
      description: mission.description,
      scope: mission.scope,
      metric: mission.metric as MissionMetric,
      target: mission.target,
      progress,
      completed: completedNow,
      claimed: nextClaimed,
      xpReward: mission.xp_reward,
      periodStart: progressRow.period_start,
      periodEnd: progressRow.period_end
    };

    missionItems.push(missionItem);

    if (justCompleted) {
      completed.push(missionItem);
      bonusXp += mission.xp_reward;
    }
  }

  return {
    missions: missionItems.sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name)),
    completed,
    bonusXp
  };
}

async function unlockAchievements(userId: string) {
  const supabase = getServiceClient();
  const [{ data: profile }, { data: achievementRows }] = await Promise.all([
    supabase
      .from("profiles")
      .select("xp, streak_count, total_questions, correct_answers")
      .eq("id", userId)
      .single(),
    supabase.from("achievements").select("*").eq("active", true)
  ]);

  const achievements = (achievementRows ?? []) as AchievementRow[];
  const accuracy =
    Number(profile?.total_questions) > 0
      ? Math.round((Number(profile?.correct_answers || 0) / Number(profile?.total_questions || 1)) * 100)
      : 0;

  const [{ count: directMatchCount }, { data: masteryRows }] = await Promise.all([
    supabase
      .from("daily_questions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .contains("ai_feedback", { directMatch: true }),
    supabase
      .from("topic_mastery")
      .select("mastery_score")
      .eq("user_id", userId)
      .order("mastery_score", { ascending: false })
      .limit(1)
  ]);

  const masteryMax = Number(masteryRows?.[0]?.mastery_score) || 0;
  const unlocked: AchievementUnlock[] = [];
  let bonusXp = 0;

  for (const achievement of achievements) {
    const code = String(achievement.code ?? "");
    const category = String(achievement.category ?? "");
    const threshold = Number(achievement.threshold) || 0;

    if (!code || threshold <= 0) {
      continue;
    }

    let metricValue = 0;
    if (category === "streak") {
      metricValue = Number(profile?.streak_count) || 0;
    } else if (category === "accuracy") {
      metricValue = accuracy;
    } else if (category === "xp") {
      metricValue = Number(profile?.xp) || 0;
    } else if (category === "direct_match") {
      metricValue = directMatchCount ?? 0;
    } else if (category === "mastery") {
      metricValue = masteryMax;
    }

    if (metricValue < threshold) {
      continue;
    }

    const achievementId = String(achievement.id ?? "");
    if (!achievementId) {
      continue;
    }

    const { data: existing, error: readError } = await supabase
      .from("user_achievements")
      .select("id")
      .eq("user_id", userId)
      .eq("achievement_id", achievementId)
      .maybeSingle();

    if (readError && readError.code !== "PGRST116") {
      throw new Error(`Failed to read user achievements: ${readError.message}`);
    }
    if (existing?.id) {
      continue;
    }

    const xpReward = Number(achievement.xp_reward) || 0;
    const unlockedAt = new Date().toISOString();
    const { error: createError } = await supabase.from("user_achievements").insert({
      user_id: userId,
      achievement_id: achievementId,
      unlocked_at: unlockedAt,
      xp_awarded: xpReward
    });

    if (createError) {
      throw new Error(`Failed to unlock achievement: ${createError.message}`);
    }

    bonusXp += xpReward;
    unlocked.push({
      code,
      name: String(achievement.name ?? code),
      description: String(achievement.description ?? ""),
      xpReward,
      unlockedAt
    });
  }

  return { unlocked, bonusXp };
}

export async function getGamificationSnapshot(userId: string) {
  const supabase = getServiceClient();
  const today = getDayInTimezone(APP_TIMEZONE);
  const weekStart = getWeekStart(today);

  const [masteryRes, missionRes, activeMissionRes, achievementRes, recentRes] = await Promise.all([
    supabase
      .from("topic_mastery")
      .select("*, topic:topics(id, name, description, created_at)")
      .eq("user_id", userId)
      .order("mastery_score", { ascending: false }),
    supabase
      .from("user_mission_progress")
      .select("*, mission:missions(*)")
      .eq("user_id", userId)
      .in("period_start", [today, weekStart])
      .order("period_start", { ascending: false }),
    supabase.from("missions").select("*").eq("active", true),
    supabase
      .from("user_achievements")
      .select("*, achievement:achievements(*)")
      .eq("user_id", userId)
      .order("unlocked_at", { ascending: false }),
    supabase
      .from("daily_questions")
      .select("ai_score, question:questions(difficulty, topic:topics(name))")
      .eq("user_id", userId)
      .not("attempted_at", "is", null)
      .order("attempted_at", { ascending: false })
      .limit(10)
  ]);

  if (masteryRes.error) {
    throw new Error(`Failed to load topic mastery snapshot: ${masteryRes.error.message}`);
  }
  if (missionRes.error) {
    throw new Error(`Failed to load mission snapshot: ${missionRes.error.message}`);
  }
  if (activeMissionRes.error) {
    throw new Error(`Failed to load active missions: ${activeMissionRes.error.message}`);
  }
  if (achievementRes.error) {
    throw new Error(`Failed to load achievement snapshot: ${achievementRes.error.message}`);
  }
  if (recentRes.error) {
    throw new Error(`Failed to load recent score snapshot: ${recentRes.error.message}`);
  }

  const mastery = (masteryRes.data ?? []) as TopicMastery[];
  const activeMissions = (activeMissionRes.data ?? []) as Mission[];
  const missionRows = (missionRes.data ?? []) as UserMissionProgress[];
  const missionRowMap = new Map<string, UserMissionProgress>();
  missionRows.forEach((row) => {
    missionRowMap.set(`${row.mission_id}:${row.period_start}`, row);
  });

  const missionProgress = activeMissions.map((mission) => {
    const period = getMissionPeriod(mission.scope, dayToUtcDate(today));
    const row = missionRowMap.get(`${mission.id}:${period.periodStart}`);
    return {
      missionId: mission.id,
      code: mission.code,
      name: mission.name,
      description: mission.description,
      scope: mission.scope,
      metric: mission.metric as MissionMetric,
      target: mission.target,
      progress: row?.progress ?? 0,
      completed: row?.completed ?? false,
      claimed: row?.claimed ?? false,
      xpReward: mission.xp_reward,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd
    } satisfies MissionProgressItem;
  });

  const achievements = ((achievementRes.data ?? []) as UserAchievement[]).map((row) => {
    const achievement = Array.isArray(row.achievement) ? row.achievement[0] : row.achievement;
    return {
      code: achievement?.code ?? "",
      name: achievement?.name ?? "Achievement",
      description: achievement?.description ?? "",
      xpReward: row.xp_awarded ?? 0,
      unlockedAt: row.unlocked_at
    } satisfies AchievementUnlock;
  });

  const recent = recentRes.data ?? [];
  const scores = recent.map((row) => Number(row.ai_score) || 0).filter((score) => score > 0);
  const avgScore = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 6;
  const lastDifficulty = recent.length
    ? Math.max(
        1,
        Math.min(
          5,
          Number(
            Array.isArray(recent[0].question)
              ? recent[0].question[0]?.difficulty
              : (recent[0].question as { difficulty?: number } | undefined)?.difficulty
          ) || 3
        )
      )
    : 3;
  const recommendedDifficulty = recommendDifficulty(avgScore, lastDifficulty as Difficulty);
  const weakestTopic = mastery.length
    ? [...mastery].sort((a, b) => Number(a.mastery_score) - Number(b.mastery_score))[0]
    : null;
  const weakestTopicName = weakestTopic
    ? Array.isArray(weakestTopic.topic)
      ? weakestTopic.topic[0]?.name
      : weakestTopic.topic?.name
    : null;

  return {
    mastery: mastery.map((row) => ({
      topicId: row.topic_id,
      topicName: Array.isArray(row.topic) ? row.topic[0]?.name ?? "General" : row.topic?.name ?? "General",
      masteryScore: Number(row.mastery_score) || 0,
      attempts: Number(row.attempts) || 0,
      correctAttempts: Number(row.correct_attempts) || 0
    })),
    missionProgress,
    achievements,
    recommendation: {
      recommendedDifficulty,
      reason:
        avgScore >= 8.6
          ? "You are consistently scoring high. Move up one difficulty."
          : avgScore <= 5.5
            ? "Recent scores are struggling. Step down one difficulty temporarily."
            : "Keep current difficulty and improve consistency.",
      focusTopic: weakestTopicName
    }
  };
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

function isMissingSessionSummaryColumn(error: { code?: string | null; message?: string | null } | null) {
  if (!error) {
    return false;
  }

  if (error.code === "PGRST204") {
    return true;
  }

  return (error.message ?? "").includes("session_summary");
}

function isMissingChatPreviewColumns(error: { code?: string | null; message?: string | null } | null) {
  if (!error) {
    return false;
  }

  if (error.code === "PGRST204") {
    return true;
  }

  const message = error.message ?? "";
  return message.includes("last_message_preview") || message.includes("last_message_at");
}

export async function saveChatMessage(sessionId: string, role: "user" | "assistant", content: string) {
  const supabase = getServiceClient();
  const nowIso = new Date().toISOString();
  const { error } = await supabase.from("chat_messages").insert({
    session_id: sessionId,
    role,
    content,
    created_at: nowIso
  });

  if (error) {
    throw new Error(`Failed to save chat message: ${error.message}`);
  }

  const { error: sessionUpdateError } = await supabase
    .from("chat_sessions")
    .update({
      last_message_preview: content.slice(0, 400),
      last_message_at: nowIso
    })
    .eq("id", sessionId);

  if (sessionUpdateError && !isMissingChatPreviewColumns(sessionUpdateError)) {
    throw new Error(`Failed to update chat session preview: ${sessionUpdateError.message}`);
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

export async function getChatSessionSummary(sessionId: string) {
  const supabase = getServiceClient();
  const { data, error } = await supabase.from("chat_sessions").select("session_summary").eq("id", sessionId).maybeSingle();

  if (error) {
    if (isMissingSessionSummaryColumn(error)) {
      return "";
    }
    throw new Error(`Failed to load chat session summary: ${error.message}`);
  }

  return typeof data?.session_summary === "string" ? data.session_summary : "";
}

export async function updateChatSessionSummary(sessionId: string, sessionSummary: string) {
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("chat_sessions")
    .update({ session_summary: sessionSummary, summary_updated_at: new Date().toISOString() })
    .eq("id", sessionId);

  if (error) {
    if (isMissingSessionSummaryColumn(error)) {
      return;
    }
    throw new Error(`Failed to update chat session summary: ${error.message}`);
  }
}
