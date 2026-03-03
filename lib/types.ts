export type Difficulty = 1 | 2 | 3 | 4 | 5;

export interface Topic {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface Question {
  id: string;
  topic_id: string;
  question_number: number;
  prompt: string;
  ideal_answer: string;
  key_points: string[];
  difficulty: Difficulty;
  active: boolean;
  created_at: string;
  topic?: Topic;
}

export interface DailyQuestion {
  id: string;
  user_id: string;
  question_id: string;
  day: string;
  unlocked_at: string;
  locked: boolean;
  attempted_at: string | null;
  gave_up: boolean;
  user_answer: string | null;
  ai_score: number | null;
  ai_feedback: EvaluationFeedback | null;
  xp_earned: number;
  hints_used: number;
  created_at: string;
  question?: Question;
}

export interface EvaluationFeedback {
  score: number;
  strengths: string[];
  missingPoints: string[];
  improvements: string[];
  summary: string;
  isCorrect: boolean;
  directMatch?: boolean;
}

export interface GiveUpFeedback {
  modelAnswer: string;
  comparison: {
    didWell: string[];
    gaps: string[];
  };
  guidance: string[];
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "system" | "user" | "assistant";
  content: string;
  created_at: string;
}

export interface Profile {
  id: string;
  email: string;
  timezone: string;
  streak_count: number;
  streak_freezes: number;
  last_freeze_grant_date: string | null;
  last_active_date: string | null;
  xp: number;
  level: string;
  total_questions: number;
  correct_answers: number;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

export interface TopicMastery {
  id: string;
  user_id: string;
  topic_id: string;
  mastery_score: number;
  attempts: number;
  correct_attempts: number;
  last_score: number | null;
  created_at: string;
  updated_at: string;
  topic?: Topic;
}

export interface Mission {
  id: string;
  code: string;
  name: string;
  description: string;
  scope: "daily" | "weekly";
  metric: "complete_questions" | "correct_answers" | "no_hint_wins" | "direct_matches" | "topic_diversity";
  target: number;
  xp_reward: number;
  active: boolean;
  created_at: string;
}

export interface UserMissionProgress {
  id: string;
  user_id: string;
  mission_id: string;
  period_start: string;
  period_end: string;
  progress: number;
  completed: boolean;
  claimed: boolean;
  completed_at: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
  mission?: Mission;
}

export interface Achievement {
  id: string;
  code: string;
  name: string;
  description: string;
  category: "streak" | "accuracy" | "xp" | "direct_match" | "mastery";
  threshold: number;
  xp_reward: number;
  active: boolean;
  created_at: string;
}

export interface UserAchievement {
  id: string;
  user_id: string;
  achievement_id: string;
  unlocked_at: string;
  xp_awarded: number;
  achievement?: Achievement;
}
