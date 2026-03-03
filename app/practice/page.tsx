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
  ai_score: number | null;
  xp_earned: number;
  ai_feedback: unknown;
  question: {
    question_number: number;
    prompt: string;
    difficulty: number;
    topic?: { name?: string };
  };
  chatSessionId: string;
}

interface DailyResponse {
  day: string;
  timezone: string;
  hoursUntilUnlock: number;
  questions: DailyQuestionItem[];
  answeredByTopic: Array<{
    topicName: string;
    questions: Array<{
      id: string;
      day: string;
      questionNumber: number;
      prompt: string;
      score: number | null;
      xpEarned: number;
      gaveUp: boolean;
    }>;
  }>;
  message?: string;
  added?: boolean;
  addedQuestionId?: string | null;
}

interface EvalResponse {
  feedback?: {
    score: number;
    strengths: string[];
    missingPoints: string[];
    improvements: string[];
    summary: string;
    isCorrect: boolean;
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
  score?: number;
  error?: string;
}

export default function PracticePage() {
  const { user, accessToken, loading } = useAuth();
  const [daily, setDaily] = useState<DailyResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requestingNext, setRequestingNext] = useState(false);
  const [result, setResult] = useState<EvalResponse | null>(null);

  useEffect(() => {
    if (!accessToken) return;

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    apiFetch<DailyResponse>("/api/daily", accessToken, {
      method: "GET",
      headers: { "x-user-timezone": timezone }
    })
      .then((res) => {
        setDaily(res);
        const nextOpen = res.questions.find((question) => !question.locked)?.id ?? null;
        setSelectedId(nextOpen ?? res.questions[0]?.id ?? null);
      })
      .catch((error) => setMessage(error.message));
  }, [accessToken]);

  const selectedQuestion = useMemo(
    () => daily?.questions.find((question) => question.id === selectedId) ?? null,
    [daily, selectedId]
  );

  async function evaluate(action: "hint" | "submit" | "giveup") {
    if (!accessToken || !selectedQuestion) return;

    setSubmitting(true);
    setMessage(null);

    try {
      const response = await apiFetch<EvalResponse>("/api/evaluate", accessToken, {
        method: "POST",
        body: JSON.stringify({
          action,
          dailyQuestionId: selectedQuestion.id,
          answer
        })
      });

      if (action === "hint") {
        setMessage(response.hint ?? "Hint generated.");
      } else {
        setResult(response);
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const refreshed = await apiFetch<DailyResponse>("/api/daily", accessToken, {
          method: "GET",
          headers: { "x-user-timezone": timezone }
        });
        setDaily(refreshed);
        const nextOpen = refreshed.questions.find((question) => !question.locked)?.id ?? null;
        setSelectedId(nextOpen ?? refreshed.questions[0]?.id ?? null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await evaluate("submit");
  }

  async function requestNextQuestion() {
    if (!accessToken) return;

    setRequestingNext(true);
    setMessage(null);

    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const response = await apiFetch<DailyResponse>("/api/daily", accessToken, {
        method: "POST",
        headers: { "x-user-timezone": timezone },
        body: JSON.stringify({ action: "next" })
      });

      setDaily(response);
      setSelectedId((prev) => response.addedQuestionId ?? prev ?? response.questions[0]?.id ?? null);
      setResult(null);
      setAnswer("");
      if (response.message) {
        setMessage(response.message);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to request next question.");
    } finally {
      setRequestingNext(false);
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
    <AppShell title="Daily Practice" subtitle={daily ? `${daily.day} • ${daily.timezone}` : "Loading daily questions..."}>
      <div className="card span-2">
        <h2>Questions</h2>
        {daily?.questions.length ? (
          <div className="question-list">
            {daily.questions.map((question, index) => (
              <button
                key={question.id}
                className={selectedId === question.id ? "question-pill active" : "question-pill"}
                onClick={() => {
                  setSelectedId(question.id);
                  setResult(null);
                  setMessage(null);
                }}
              >
                <span>Q{index + 1}</span>
                <span>#{question.question.question_number}</span>
                <span>D{question.question.difficulty}</span>
                <span>{question.locked ? "Locked" : "Open"}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">No questions configured yet. Ask admin to add active questions.</p>
        )}
        <div className="inline-actions">
          <button type="button" className="secondary" onClick={requestNextQuestion} disabled={requestingNext || submitting}>
            {requestingNext ? "Loading..." : "Ask for Next Question"}
          </button>
        </div>
      </div>

      {selectedQuestion ? (
        <div className="card span-2">
          <h3>{selectedQuestion.question.topic?.name ?? "General"}</h3>
          <p>{selectedQuestion.question.prompt}</p>

          {selectedQuestion.locked ? (
            <div className="locked-note">This question is already completed and locked for today.</div>
          ) : (
            <form className="stack" onSubmit={onSubmit}>
              <textarea
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="Write your interview answer..."
                rows={8}
                required
              />
              <div className="inline-actions">
                <button type="submit" disabled={submitting || !answer.trim()}>
                  Submit for Evaluation
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => evaluate("hint")}
                  disabled={submitting || !answer.trim()}
                >
                  Ask Hint
                </button>
                <button type="button" className="danger" onClick={() => evaluate("giveup")} disabled={submitting}>
                  I Give Up
                </button>
              </div>
            </form>
          )}

          <div className="inline-actions">
            <Link href={`/practice/chat/${selectedQuestion.id}`} className="button-link ghost">
              Open Dedicated Chat
            </Link>
          </div>

          {message ? <div className="status">{message}</div> : null}
        </div>
      ) : null}

      {result ? (
        <div className="card span-2">
          {result.feedback && "score" in result.feedback ? (
            <>
              <h3>AI Evaluation</h3>
              <p>
                Score: <strong>{result.feedback.score}/10</strong> | XP Earned: <strong>{result.xpEarned ?? 0}</strong>
              </p>
              <p>{result.feedback.summary}</p>
              <div className="result-grid">
                <div>
                  <h4>Strengths</h4>
                  <ul>
                    {result.feedback.strengths.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4>Missing</h4>
                  <ul>
                    {result.feedback.missingPoints.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4>Improve Next</h4>
                  <ul>
                    {result.feedback.improvements.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          ) : result.feedback ? (
            <>
              <h3>Give-Up Review</h3>
              <h4>Ideal Structured Answer</h4>
              <p>{result.feedback.modelAnswer}</p>
              <div className="result-grid">
                <div>
                  <h4>What You Did Well</h4>
                  <ul>
                    {result.feedback.comparison.didWell.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4>Gap Analysis</h4>
                  <ul>
                    {result.feedback.comparison.gaps.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4>How to Improve</h4>
                  <ul>
                    {result.feedback.guidance.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          ) : (
            <p className="muted">No evaluation data available.</p>
          )}
        </div>
      ) : null}

      <div className="card">
        <h3>Unlock Rules</h3>
        <p className="muted">Once attempted, a question is locked until the next local midnight.</p>
        <p className="muted">Approx. {daily?.hoursUntilUnlock ?? "-"} hour(s) until next unlock window.</p>
      </div>

      <div className="card span-2">
        <h3>Answered Questions by Topic</h3>
        {daily?.answeredByTopic?.length ? (
          <div className="topic-progress-list">
            {daily.answeredByTopic.map((topic) => (
              <details key={topic.topicName} open>
                <summary>
                  {topic.topicName} ({topic.questions.length})
                </summary>
                <div className="admin-list">
                  {topic.questions.map((question) => (
                    <div key={question.id} className="admin-item">
                      <div>
                        <strong>Q{question.questionNumber}</strong>
                        <p className="muted small">{question.prompt}</p>
                      </div>
                      <div className="muted small">
                        {question.gaveUp ? "Gave up" : `Score ${question.score ?? "-"}/10`} • XP {question.xpEarned} •{" "}
                        {question.day}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        ) : (
          <p className="muted">No answered questions yet.</p>
        )}
      </div>
    </AppShell>
  );
}
