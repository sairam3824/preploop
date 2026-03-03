"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/components/api-fetch";
import { AppShell } from "@/components/app-shell";
import { AuthPanel } from "@/components/auth-panel";
import { useAuth } from "@/components/auth-provider";
import { StatsStrip } from "@/components/stats-strip";

interface HistoryResponse {
  profile: {
    xp: number;
    level: string;
    streak_count: number;
    total_questions: number;
    correct_answers: number;
  };
  history: Array<{
    day: string;
    average_score: number;
    accuracy_pct: number;
    streak: number;
    total_xp: number;
  }>;
  topicProgress: Array<{
    topicName: string;
    answered: number;
    avgScore: number;
    progressPct: number;
  }>;
}

export default function HistoryPage() {
  const { user, accessToken, loading } = useAuth();
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;

    apiFetch<HistoryResponse>("/api/history", accessToken)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [accessToken]);

  const history = useMemo(() => data?.history ?? [], [data?.history]);
  const maxScore = useMemo(
    () => Math.max(10, ...history.map((item) => Number(item.average_score) || 0)),
    [history]
  );

  if (loading) {
    return (
      <AppShell title="History" subtitle="Loading...">
        <div className="card">Loading...</div>
      </AppShell>
    );
  }

  if (!user || !accessToken) {
    return (
      <AppShell title="History" subtitle="Sign in required">
        <AuthPanel />
      </AppShell>
    );
  }

  return (
    <AppShell title="Performance History" subtitle="Track streak, XP, and topic consistency over time.">
      <StatsStrip
        items={[
          { label: "XP", value: data?.profile.xp ?? 0, highlight: true },
          { label: "Level", value: data?.profile.level ?? "Beginner" },
          { label: "Streak", value: `${data?.profile.streak_count ?? 0} days` },
          {
            label: "Accuracy",
            value:
              data?.profile.total_questions
                ? `${Math.round((data.profile.correct_answers / data.profile.total_questions) * 100)}%`
                : "0%"
          }
        ]}
      />

      <div className="card span-2">
        <h2>Performance Graph</h2>
        <div className="chart-grid">
          {history.length === 0 ? <p className="muted">No completed attempts yet.</p> : null}
          {history.map((point) => (
            <div key={point.day} className="chart-row">
              <div className="chart-label">{point.day}</div>
              <div className="chart-bar-wrap">
                <div className="chart-bar" style={{ width: `${(point.average_score / maxScore) * 100}%` }} />
              </div>
              <div className="chart-value">{point.average_score}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card span-2">
        <h2>Topic Progress</h2>
        {data?.topicProgress.length ? (
          <div className="topic-progress-list">
            {data.topicProgress.map((topic) => (
              <div key={topic.topicName} className="topic-progress-item">
                <div className="inline-line">
                  <strong>{topic.topicName}</strong>
                  <span className="muted">
                    {topic.answered} answered • avg {topic.avgScore}/10
                  </span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${topic.progressPct}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Topic progress appears after your first scored answer.</p>
        )}
      </div>

      {error ? <div className="card error">{error}</div> : null}
    </AppShell>
  );
}
