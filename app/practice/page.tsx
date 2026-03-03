"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/components/api-fetch";
import { AppShell } from "@/components/app-shell";
import { AuthPanel } from "@/components/auth-panel";
import { useAuth } from "@/components/auth-provider";

interface DailyQuestionItem {
  id: string;
  locked: boolean;
  hints_used: number;
  helpTurns?: number;
  ai_score: number | null;
  xp_earned: number;
  ai_feedback: unknown;
  question: {
    question_number: number;
    prompt: string;
    difficulty: number;
    topic?: { id?: string; name?: string };
  };
  chatSessionId: string;
}

interface TopicItem {
  id: string;
  name: string;
  description: string | null;
}

interface TopicsResponse {
  topics: TopicItem[];
}

interface AnsweredByTopicQuestion {
  id: string;
  day: string;
  questionNumber: number;
  prompt: string;
  score: number | null;
  xpEarned: number;
  gaveUp: boolean;
}

interface AnsweredByTopicItem {
  topicName: string;
  questions: AnsweredByTopicQuestion[];
}

interface DailyResponse {
  day: string;
  timezone: string;
  hoursUntilUnlock: number;
  questions: DailyQuestionItem[];
  answeredByTopic: AnsweredByTopicItem[];
}

interface EvalResponse {
  feedback?: {
    score: number;
    strengths: string[];
    missingPoints: string[];
    improvements: string[];
    summary: string;
    isCorrect: boolean;
    directMatch?: boolean;
  } | {
    modelAnswer: string;
    comparison: {
      didWell: string[];
      gaps: string[];
    };
    guidance: string[];
  };
  hint?: string;
  hintsUsed?: number;
  xpEarned?: number;
  xpBreakdown?: {
    baseXp: number;
    scoreBonus: number;
    directMatchBoost: number;
    hintPenalty: number;
    coachingPenalty: number;
    missionBonus: number;
    achievementBonus: number;
    maxPossible: number;
    totalEarned: number;
  };
  missionsCompleted?: Array<{
    name: string;
    scope: "daily" | "weekly";
    xpReward: number;
  }>;
  missionProgress?: Array<{
    missionId: string;
    code: string;
    name: string;
    description: string;
    scope: "daily" | "weekly";
    target: number;
    progress: number;
    completed: boolean;
    xpReward: number;
  }>;
  achievementsUnlocked?: Array<{
    code: string;
    name: string;
    description: string;
    xpReward: number;
    unlockedAt: string;
  }>;
  mastery?: {
    topicId: string;
    masteryScore: number;
    attempts: number;
    correctAttempts: number;
  } | null;
  score?: number;
  needsRetry?: boolean;
  message?: string;
  cheer?: string;
  followUpQuestion?: string;
  helpTurns?: number;
  error?: string;
}

interface ChatResponse {
  sessionId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

const XP_BASE_BY_DIFFICULTY: Record<number, number> = {
  1: 10,
  2: 14,
  3: 18,
  4: 24,
  5: 30
};

function getMaxPossibleXp(difficulty: number) {
  const base = XP_BASE_BY_DIFFICULTY[difficulty] ?? 10;
  return base + 10;
}

function truncateText(input: string, max = 80) {
  if (input.length <= max) return input;
  return `${input.slice(0, max).trim()}...`;
}

export default function PracticePage() {
  const { user, accessToken, loading } = useAuth();

  const [daily, setDaily] = useState<DailyResponse | null>(null);
  const [topics, setTopics] = useState<TopicItem[]>([]);

  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requestingNext, setRequestingNext] = useState(false);

  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [sendingChat, setSendingChat] = useState(false);
  const [lastEvaluation, setLastEvaluation] = useState<EvalResponse | null>(null);

  async function refreshDaily(token: string) {
    const dailyRes = await apiFetch<DailyResponse>("/api/daily", token, { method: "GET" });
    setDaily(dailyRes);
    return dailyRes;
  }

  useEffect(() => {
    if (!accessToken) return;

    Promise.all([
      refreshDaily(accessToken),
      apiFetch<TopicsResponse>("/api/topics", accessToken, { method: "GET" })
    ])
      .then(([dailyRes, topicsRes]) => {
        setTopics(topicsRes.topics ?? []);
        const nextOpen = dailyRes.questions.find((question) => !question.locked)?.id ?? null;
        setSelectedId(nextOpen ?? dailyRes.questions[0]?.id ?? null);
        setLastEvaluation(null);
      })
      .catch((error) => setStatus(error.message));
  }, [accessToken]);

  const filteredQuestions = useMemo(() => {
    const questions = daily?.questions ?? [];
    if (!selectedTopicId) {
      return questions;
    }

    return questions.filter((question) => question.question.topic?.id === selectedTopicId);
  }, [daily, selectedTopicId]);

  useEffect(() => {
    if (filteredQuestions.length === 0) {
      setSelectedId(null);
      return;
    }

    setSelectedId((current) => {
      if (current && filteredQuestions.some((question) => question.id === current)) {
        return current;
      }

      return filteredQuestions.find((question) => !question.locked)?.id ?? filteredQuestions[0]?.id ?? null;
    });
  }, [filteredQuestions]);

  const selectedQuestion = useMemo(
    () => filteredQuestions.find((question) => question.id === selectedId) ?? null,
    [filteredQuestions, selectedId]
  );

  const canRequestNextQuestion = useMemo(() => {
    const questions = daily?.questions ?? [];
    return questions.length === 0 || questions.every((question) => question.locked);
  }, [daily]);

  const xpPreview = useMemo(() => {
    if (!selectedQuestion) return null;

    const maxPossible = getMaxPossibleXp(selectedQuestion.question.difficulty);
    const hintPenalty = (selectedQuestion.hints_used ?? 0) * 3;
    const helpPenalty = (selectedQuestion.helpTurns ?? 0) * 2;
    const totalPenalty = hintPenalty + helpPenalty;

    return {
      maxPossible,
      totalPenalty,
      currentPotential: Math.max(0, maxPossible - totalPenalty)
    };
  }, [selectedQuestion]);

  async function refreshSelectedChat(token: string, dailyQuestionId: string) {
    const chatRes = await apiFetch<ChatResponse>(`/api/chat?dailyQuestionId=${dailyQuestionId}`, token, { method: "GET" });
    setChatMessages(chatRes.messages ?? []);
  }

  useEffect(() => {
    if (!accessToken || !selectedQuestion?.id) {
      setChatMessages([]);
      return;
    }

    refreshSelectedChat(accessToken, selectedQuestion.id).catch((error) => setStatus(error.message));
  }, [accessToken, selectedQuestion?.id]);

  async function evaluate(action: "hint" | "submit" | "giveup") {
    if (!accessToken || !selectedQuestion) return;

    setSubmitting(true);
    setStatus(null);

    try {
      const response = await apiFetch<EvalResponse>("/api/evaluate", accessToken, {
        method: "POST",
        body: JSON.stringify({
          action,
          dailyQuestionId: selectedQuestion.id,
          answer: draft
        })
      });

      if (action === "hint") {
        setStatus(response.hint ?? "Hint generated.");
        setLastEvaluation(null);
      } else if (response.needsRetry) {
        setStatus(response.message ?? response.hint ?? "Not fully correct yet. Improve and submit again.");
        setLastEvaluation(response);
      } else if (response.feedback && "score" in response.feedback) {
        setStatus(`Submitted. Score ${response.feedback.score}/10, XP ${response.xpEarned ?? 0}.`);
        setLastEvaluation(response);
      } else {
        setStatus(`Give-up submitted. XP ${response.xpEarned ?? 0}.`);
        setLastEvaluation(response);
      }

      if (action !== "hint") {
        setDraft("");
      }

      const refreshedDaily = await refreshDaily(accessToken);
      const nextOpen = refreshedDaily.questions.find((question) => !question.locked)?.id ?? null;
      if (action !== "hint") {
        setSelectedId((prev) => (selectedQuestion.locked ? prev : nextOpen ?? prev));
      }
      await refreshSelectedChat(accessToken, selectedQuestion.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function requestNextQuestion() {
    if (!accessToken) return;

    setRequestingNext(true);
    setStatus(null);

    try {
      const response = await apiFetch<DailyResponse & { message?: string; addedQuestionId?: string | null }>("/api/daily", accessToken, {
        method: "POST",
        body: JSON.stringify({ action: "next", topicId: selectedTopicId || undefined })
      });

      setDaily(response);
      setSelectedId((prev) => response.addedQuestionId ?? prev ?? response.questions[0]?.id ?? null);
      setDraft("");
      setLastEvaluation(null);
      if (response.message) {
        setStatus(response.message);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to request next question.");
    } finally {
      setRequestingNext(false);
    }
  }

  async function sendChatMessage(event: FormEvent) {
    event.preventDefault();
    if (!accessToken || !selectedQuestion || !draft.trim()) return;

    const userMessage = { role: "user" as const, content: draft.trim() };
    setDraft("");
    setSendingChat(true);
    setChatMessages((prev) => [...prev, userMessage]);

    try {
      const response = await apiFetch<{ reply: string }>("/api/chat", accessToken, {
        method: "POST",
        body: JSON.stringify({
          dailyQuestionId: selectedQuestion.id,
          message: userMessage.content
        })
      });

      setChatMessages((prev) => [...prev, { role: "assistant", content: response.reply }]);
      await refreshDaily(accessToken);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to send message.");
    } finally {
      setSendingChat(false);
    }
  }

  if (loading) {
    return (
      <AppShell title="Practice" subtitle="Loading...">
        <div className="card">Loading...</div>
      </AppShell>
    );
  }

  if (!user || !accessToken) {
    return (
      <AppShell title="Practice" subtitle="Sign in required">
        <AuthPanel />
      </AppShell>
    );
  }

  return (
    <AppShell title="Practice Studio" subtitle={daily ? `${daily.day} • IST (UTC+05:30)` : "Loading..."}>
      {status ? <div className="card status span-2">{status}</div> : null}

      <section className="practice-main span-2">
        <div className="practice-toolbar">
          <div className="inline-actions">
            <select
              className="toolbar-select"
              value={selectedTopicId}
              onChange={(event) => {
                setSelectedTopicId(event.target.value);
                setDraft("");
                setStatus(null);
                setLastEvaluation(null);
              }}
            >
              <option value="">All Topics</option>
              {topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.name}
                </option>
              ))}
            </select>

            <select
              className="toolbar-select"
              value={selectedId ?? ""}
              onChange={(event) => {
                setSelectedId(event.target.value || null);
                setDraft("");
                setStatus(null);
                setLastEvaluation(null);
              }}
            >
              {filteredQuestions.length === 0 ? <option value="">No questions</option> : null}
              {filteredQuestions.map((question, index) => (
                <option key={question.id} value={question.id}>
                  Question {index + 1}: {truncateText(question.question.prompt, 56)}
                </option>
              ))}
            </select>
          </div>

          <div className="inline-actions">
            {canRequestNextQuestion ? (
              <button
                type="button"
                className="secondary"
                onClick={requestNextQuestion}
                disabled={requestingNext || submitting}
              >
                {requestingNext ? "Loading..." : "Ask for Next Question"}
              </button>
            ) : (
              <span className="muted small">Complete current question to unlock next.</span>
            )}
            <Link href="/chat-history" className="button-link ghost">
              Open Chat History
            </Link>
          </div>
        </div>

        {daily?.answeredByTopic && daily.answeredByTopic.length > 0 ? (
          <div className="practice-panel">
            <h4>Answered by Topic</h4>
            {daily.answeredByTopic.map((topicGroup) => (
              <div key={topicGroup.topicName} className="topic-progress-item">
                <strong>{topicGroup.topicName}</strong>
                <span className="muted small"> — {topicGroup.questions.length} answered</span>
                <ul className="muted small">
                  {topicGroup.questions.map((q) => (
                    <li key={q.id}>
                      Q{q.questionNumber}: {q.gaveUp ? "gave up" : `score ${q.score ?? "—"}/10`} · {q.xpEarned} XP
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}

        {selectedQuestion ? (
          <>
            <div className="practice-panel">
              <div className="inline-line">
                <h3>{selectedQuestion.question.topic?.name ?? "General"}</h3>
                <span className="muted small">
                  Difficulty {selectedQuestion.question.difficulty}/5 • {selectedQuestion.locked ? "Completed" : "Open"}
                </span>
              </div>
              <p className="practice-question-prompt">{selectedQuestion.question.prompt}</p>
              {xpPreview ? (
                <div className="status">
                  Potential XP now: <strong>{xpPreview.currentPotential}</strong> / {xpPreview.maxPossible}
                  <p className="muted small">
                    Current penalty: -{xpPreview.totalPenalty} ({selectedQuestion.hints_used} hints, {selectedQuestion.helpTurns ?? 0} coaching turns)
                  </p>
                </div>
              ) : null}
            </div>

            {selectedQuestion.locked ? (
              <div className="locked-note">This question is completed. You can continue chatting with the coach.</div>
            ) : null}

            <div className="practice-panel">
              <h4>Coach Chatbot</h4>
              <p className="muted small">Use this one box for both answer submission and coaching chat.</p>

              <div className="chat-box">
                {chatMessages.length === 0 ? <p className="muted">No messages yet.</p> : null}
                {chatMessages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className={message.role === "user" ? "bubble user" : "bubble assistant"}>
                    <span className="bubble-role">{message.role === "user" ? "You" : "Coach"}</span>
                    <p>{message.content}</p>
                  </div>
                ))}
              </div>

              <form className="stack" onSubmit={sendChatMessage}>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={
                    selectedQuestion.locked
                      ? "Ask follow-up questions about this answer..."
                      : "Type your answer or ask coach for guidance..."
                  }
                  rows={5}
                  required
                />
                <div className="inline-actions">
                  {!selectedQuestion.locked ? (
                    <>
                      <button type="button" onClick={() => evaluate("submit")} disabled={submitting || !draft.trim()}>
                        Submit for Evaluation
                      </button>
                      <button type="button" className="secondary" onClick={() => evaluate("hint")} disabled={submitting}>
                        Ask Hint
                      </button>
                      <button type="button" className="danger" onClick={() => evaluate("giveup")} disabled={submitting}>
                        I Give Up
                      </button>
                    </>
                  ) : null}
                  <button type="submit" className="secondary" disabled={sendingChat || !draft.trim()}>
                    {sendingChat ? "Sending..." : "Send to Coach"}
                  </button>
                </div>
              </form>
            </div>

            {lastEvaluation?.xpBreakdown ? (
              <div className="practice-panel">
                <h4>XP Breakdown</h4>
                <div className="topic-progress-list">
                  <div className="topic-progress-item">
                    <div className="inline-line">
                      <strong>Base + Score Bonus</strong>
                      <span className="muted">
                        {lastEvaluation.xpBreakdown.baseXp} + {lastEvaluation.xpBreakdown.scoreBonus} +{" "}
                        {lastEvaluation.xpBreakdown.directMatchBoost}
                      </span>
                    </div>
                    <p className="muted small">
                      Penalties: -{lastEvaluation.xpBreakdown.hintPenalty} hints, -{lastEvaluation.xpBreakdown.coachingPenalty} coaching
                    </p>
                  </div>
                  <div className="topic-progress-item">
                    <div className="inline-line">
                      <strong>Mission + Achievement Bonus</strong>
                      <span className="muted">
                        +{lastEvaluation.xpBreakdown.missionBonus} +{lastEvaluation.xpBreakdown.achievementBonus}
                      </span>
                    </div>
                    <p className="muted small">Total earned: {lastEvaluation.xpBreakdown.totalEarned} XP</p>
                  </div>
                </div>

                {lastEvaluation.missionsCompleted?.length ? (
                  <>
                    <h4>Mission Completed</h4>
                    <ul>
                      {lastEvaluation.missionsCompleted.map((mission, index) => (
                        <li key={`${mission.name}-${index}`}>
                          {mission.name} ({mission.scope}) +{mission.xpReward} XP
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}

                {lastEvaluation.achievementsUnlocked?.length ? (
                  <>
                    <h4>Achievement Unlocked</h4>
                    <ul>
                      {lastEvaluation.achievementsUnlocked.map((achievement) => (
                        <li key={`${achievement.code}-${achievement.unlockedAt}`}>
                          {achievement.name} +{achievement.xpReward} XP
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}

                {lastEvaluation.mastery ? (
                  <p className="muted small">
                    Topic mastery updated: {Math.round(lastEvaluation.mastery.masteryScore)}/100 (
                    {lastEvaluation.mastery.correctAttempts}/{lastEvaluation.mastery.attempts} correct)
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <div className="practice-panel">
            <h3>No Question Selected</h3>
            <p className="muted">Pick a topic and click "Ask for Next Question" to start.</p>
          </div>
        )}
      </section>
    </AppShell>
  );
}
