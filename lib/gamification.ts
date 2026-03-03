import { Difficulty } from "@/lib/types";

const XP_BASE_BY_DIFFICULTY: Record<Difficulty, number> = {
  1: 10,
  2: 14,
  3: 18,
  4: 24,
  5: 30
};

export function calculateXp(params: {
  difficulty: Difficulty;
  score: number;
  hintsUsed: number;
  gaveUp: boolean;
}) {
  const { difficulty, score, hintsUsed, gaveUp } = params;

  if (gaveUp) {
    return 0;
  }

  const base = XP_BASE_BY_DIFFICULTY[difficulty] ?? 10;
  const scoreBonus = Math.max(0, Math.round(score) - 5) * 2;
  const hintPenalty = hintsUsed * 3;

  return Math.max(0, base + scoreBonus - hintPenalty);
}

export function calculateLevel(xp: number) {
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
