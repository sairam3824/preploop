import { Difficulty } from "@/lib/types";

export const XP_BASE_BY_DIFFICULTY: Record<Difficulty, number> = {
  1: 10,
  2: 14,
  3: 18,
  4: 24,
  5: 30
};

export interface XpBreakdown {
  baseXp: number;
  scoreBonus: number;
  directMatchBoost: number;
  hintPenalty: number;
  coachingPenalty: number;
  missionBonus: number;
  achievementBonus: number;
  maxPossible: number;
  totalEarned: number;
}

export function calculateXpBreakdown(params: {
  difficulty: Difficulty;
  score: number;
  hintsUsed: number;
  helpTurns: number;
  directMatch?: boolean;
  gaveUp: boolean;
  missionBonus?: number;
  achievementBonus?: number;
}) {
  const {
    difficulty,
    score,
    hintsUsed,
    helpTurns,
    directMatch,
    gaveUp,
    missionBonus = 0,
    achievementBonus = 0
  } = params;

  if (gaveUp) {
    const safeMissionBonus = Math.max(0, missionBonus);
    const safeAchievementBonus = Math.max(0, achievementBonus);
    return {
      baseXp: 0,
      scoreBonus: 0,
      directMatchBoost: 0,
      hintPenalty: 0,
      coachingPenalty: 0,
      missionBonus: safeMissionBonus,
      achievementBonus: safeAchievementBonus,
      maxPossible: 0,
      totalEarned: safeMissionBonus + safeAchievementBonus
    } satisfies XpBreakdown;
  }

  const base = XP_BASE_BY_DIFFICULTY[difficulty] ?? 10;
  const maxScoreBonus = (10 - 5) * 2;
  const maxPossible = base + maxScoreBonus;
  const rawScoreBonus = Math.max(0, Math.round(score) - 5) * 2;
  const directMatchBoost =
    directMatch && hintsUsed === 0 && helpTurns === 0 ? Math.max(0, maxScoreBonus - rawScoreBonus) : 0;
  const scoreBonus = rawScoreBonus + directMatchBoost;
  const hintPenalty = hintsUsed * 3;
  const helpPenalty = helpTurns * 2;
  const coreXp = Math.max(0, base + scoreBonus - hintPenalty - helpPenalty);
  const totalEarned = Math.max(0, coreXp + Math.max(0, missionBonus) + Math.max(0, achievementBonus));

  return {
    baseXp: base,
    scoreBonus: rawScoreBonus,
    directMatchBoost,
    hintPenalty,
    coachingPenalty: helpPenalty,
    missionBonus: Math.max(0, missionBonus),
    achievementBonus: Math.max(0, achievementBonus),
    maxPossible,
    totalEarned
  } satisfies XpBreakdown;
}

export function calculateXp(params: {
  difficulty: Difficulty;
  score: number;
  hintsUsed: number;
  helpTurns: number;
  directMatch?: boolean;
  gaveUp: boolean;
  missionBonus?: number;
  achievementBonus?: number;
}) {
  return calculateXpBreakdown(params).totalEarned;
}

export function calculateMasteryScore(params: {
  currentScore: number;
  score: number;
  difficulty: Difficulty;
  directMatch?: boolean;
  gaveUp?: boolean;
  hintsUsed?: number;
}) {
  const {
    currentScore,
    score,
    difficulty,
    directMatch = false,
    gaveUp = false,
    hintsUsed = 0
  } = params;

  if (gaveUp) {
    return Math.max(0, Number((currentScore * 0.96).toFixed(2)));
  }

  const normalized = Math.max(0, Math.min(100, score * 10));
  const difficultyWeight = 1 + (difficulty - 1) * 0.08;
  const directBonus = directMatch ? 8 : 0;
  const hintPenalty = hintsUsed * 2;
  const effective = Math.max(0, Math.min(100, normalized * difficultyWeight + directBonus - hintPenalty));
  const blended = currentScore * 0.82 + effective * 0.18;

  return Number(Math.max(0, Math.min(100, blended)).toFixed(2));
}

export function getMissionPeriod(scope: "daily" | "weekly", date: Date) {
  const current = new Date(date);
  const toDate = (d: Date) => d.toISOString().slice(0, 10);

  if (scope === "daily") {
    return {
      periodStart: toDate(current),
      periodEnd: toDate(current)
    };
  }

  const weekday = current.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = new Date(current);
  monday.setUTCDate(current.getUTCDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    periodStart: toDate(monday),
    periodEnd: toDate(sunday)
  };
}

export function recommendDifficulty(avgScore: number, currentDifficulty: Difficulty): Difficulty {
  if (avgScore >= 8.6) {
    return Math.min(5, currentDifficulty + 1) as Difficulty;
  }

  if (avgScore <= 5.5) {
    return Math.max(1, currentDifficulty - 1) as Difficulty;
  }

  return currentDifficulty;
}

export function calculateLevel(xp: number) {
  if (xp >= 2400) return "Elite";
  if (xp >= 1500) return "Expert";
  if (xp >= 700) return "Pro";
  return "Beginner";
}

export function calculateAccuracy(totalQuestions: number, correctAnswers: number) {
  if (totalQuestions === 0) {
    return 0;
  }

  return Math.round((correctAnswers / totalQuestions) * 100);
}
