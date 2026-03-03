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
  last_active_date: string | null;
  xp: number;
  level: string;
  total_questions: number;
  correct_answers: number;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}
