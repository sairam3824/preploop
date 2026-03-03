"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/components/api-fetch";
import { AppShell } from "@/components/app-shell";
import { AuthPanel } from "@/components/auth-panel";
import { useAuth } from "@/components/auth-provider";
import { StatsStrip } from "@/components/stats-strip";

interface ProfileResponse {
  profile: {
    email: string;
    timezone: string;
    xp: number;
    level: string;
    streak_count: number;
    streak_freezes: number;
    total_questions: number;
    correct_answers: number;
    is_admin: boolean;
  };
}

interface DailyResponse {
  day: string;
  hoursUntilUnlock: number;
  questions: Array<{ id: string; locked: boolean }>;
}

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
  gamification?: {
    mastery: Array<{
      topicId: string;
      topicName: string;
      masteryScore: number;
      attempts: number;
      correctAttempts: number;
    }>;
    missionProgress: Array<{
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
    achievements: Array<{
      code: string;
      name: string;
      description: string;
      xpReward: number;
      unlockedAt: string;
    }>;
    recommendation: {
      recommendedDifficulty: number;
      reason: string;
      focusTopic: string | null;
    };
  };
}

export default function HomePage() {
  const { user, accessToken, loading, signOut } = useAuth();
  const [profile, setProfile] = useState<ProfileResponse["profile"] | null>(null);
  const [daily, setDaily] = useState<DailyResponse | null>(null);
  const [historyData, setHistoryData] = useState<HistoryResponse | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    Promise.all([
      apiFetch<ProfileResponse>("/api/profile", accessToken, { method: "GET" }),
      apiFetch<DailyResponse>("/api/daily", accessToken, { method: "GET" }),
      apiFetch<HistoryResponse>("/api/history", accessToken, { method: "GET" })
    ])
      .then(([profileRes, dailyRes, historyRes]) => {
        setProfile(profileRes.profile);
        setDaily(dailyRes);
        setHistoryData(historyRes);
      })
      .catch((error) => setStatus(error.message));
  }, [accessToken]);

  const accuracy = useMemo(() => {
    if (!profile || profile.total_questions === 0) return 0;
    return Math.round((profile.correct_answers / profile.total_questions) * 100);
  }, [profile]);

  const consistencyBadge = useMemo(() => {
    const streak = profile?.streak_count ?? 0;
    if (streak >= 30) return "Diamond Consistency";
    if (streak >= 14) return "Gold Consistency";
    if (streak >= 7) return "Silver Consistency";
    if (streak >= 3) return "Bronze Consistency";
    return "Starter Badge";
  }, [profile]);

  const history = useMemo(() => historyData?.history ?? [], [historyData?.history]);
  const maxScore = useMemo(
    () => Math.max(10, ...history.map((item) => Number(item.average_score) || 0)),
    [history]
  );

  if (loading) {
    return (
      <AppShell title="Daily Interview Practice" subtitle="Loading account...">
        <div className="card">Loading...</div>
      </AppShell>
    );
  }

  if (!user || !accessToken) {
    return (
      <div className="landing-page">
        <nav className="landing-nav">
          <div className="nav-container">
            <div className="logo">
              <span className="logo-mark" aria-hidden />
              <span className="logo-text">Daily Interview Practice</span>
            </div>
          </div>
        </nav>

        <main className="landing-main">
          <section className="hero-section">
            <div className="hero-grid">
              <div className="hero-content">
                <div className="hero-badge">AI-led interview prep</div>
                <h1 className="hero-title">
                  Build sharp answers
                  <span className="hero-gradient"> through daily repetition.</span>
                </h1>
                <p className="hero-description">
                  Practice one focused interview question each day, get AI critique, and track the consistency that
                  converts prep into confidence.
                </p>
                <div className="hero-actions">
                  <AuthPanel />
                </div>
              </div>

              <div className="hero-visual">
                <div className="visual-headline">Today&apos;s Flow</div>
                <div className="visual-row">
                  <span className="visual-label">Question unlocks daily in IST (UTC+05:30)</span>
                  <span className="visual-value">1-2 prompts</span>
                </div>
                <div className="visual-row">
                  <span className="visual-label">Answer with structure and examples</span>
                  <span className="visual-value">8-12 min</span>
                </div>
                <div className="visual-row">
                  <span className="visual-label">AI evaluates strengths and gaps</span>
                  <span className="visual-value">Score /10</span>
                </div>
                <div className="visual-row">
                  <span className="visual-label">Streak, XP, and topic progress update</span>
                  <span className="visual-value">Daily loop</span>
                </div>
              </div>
            </div>
          </section>

          <section className="features-section">
            <div className="features-header">
              <h2 className="features-title">A tighter practice workflow</h2>
              <p className="features-subtitle">
                Designed to force deliberate practice, fast feedback, and consistent momentum.
              </p>
            </div>

            <div className="features-grid">
              <div className="feature-card">
                <span className="feature-tag">Daily</span>
                <h3 className="feature-title">IST-based unlocks</h3>
                <p className="feature-description">Each day opens fresh questions on IST midnight for consistent cadence.</p>
              </div>

              <div className="feature-card">
                <span className="feature-tag">Evaluate</span>
                <h3 className="feature-title">AI scoring with actionable notes</h3>
                <p className="feature-description">See what you explained well and exactly what you missed.</p>
              </div>

              <div className="feature-card">
                <span className="feature-tag">Coach</span>
                <h3 className="feature-title">Per-question coaching chat</h3>
                <p className="feature-description">Ask follow-ups in persistent context tied to each prompt.</p>
              </div>

              <div className="feature-card">
                <span className="feature-tag">Progress</span>
                <h3 className="feature-title">XP, streak, and accuracy tracking</h3>
                <p className="feature-description">Measure effort and quality over time instead of guessing progress.</p>
              </div>

              <div className="feature-card">
                <span className="feature-tag">Topics</span>
                <h3 className="feature-title">Coverage by subject area</h3>
                <p className="feature-description">Identify weak topics quickly and prioritize what to drill next.</p>
              </div>

              <div className="feature-card">
                <span className="feature-tag">Consistency</span>
                <h3 className="feature-title">Gamified without distraction</h3>
                <p className="feature-description">Simple incentives to keep practicing without noisy gimmicks.</p>
              </div>
            </div>
          </section>
        </main>

        <footer className="landing-footer">
          <p>Daily Interview Practice • Focused preparation that compounds.</p>
        </footer>
      </div>
    );
  }

  return (
    <AppShell
      title="Daily Interview Practice"
      subtitle={profile ? `Welcome ${profile.email}` : "Welcome"}
      right={
        <button className="secondary" onClick={() => signOut()}>
          Sign Out
        </button>
      }
    >
      <div className="card span-2">
        <h2>Today</h2>
        <p className="muted">
          {daily ? `${daily.questions.length} question(s) unlocked for ${daily.day}` : "Loading daily questions..."}
        </p>
        <div className="inline-actions">
          <Link href="/practice" className="button-link">
            Start Practice
          </Link>
          <Link href="/chat-history" className="button-link ghost">
            Open Chat History
          </Link>
        </div>
        {daily ? <p className="muted small">Next unlock in about {daily.hoursUntilUnlock} hour(s).</p> : null}
      </div>

      <StatsStrip
        items={[
          { label: "XP", value: profile?.xp ?? 0, highlight: true },
          { label: "Level", value: profile?.level ?? "Beginner" },
          { label: "Streak", value: `${profile?.streak_count ?? 0} days` },
          { label: "Accuracy", value: `${accuracy}%` }
        ]}
      />

      <div className="card">
        <h3>Progress System</h3>
        <ul>
          <li>Base XP increases with question difficulty</li>
          <li>Higher AI score gives bonus XP</li>
          <li>Each hint reduces XP gained for that question</li>
          <li>Give-up submissions award 0 XP</li>
        </ul>
      </div>

      <div className="card">
        <h3>Consistency Badge</h3>
        <p className="muted">Current badge: {consistencyBadge}</p>
        <p className="muted small">Maintain daily streaks to unlock higher tiers.</p>
        <p className="muted small">Streak freezes available: {profile?.streak_freezes ?? 0}</p>
      </div>

      <div className="card">
        <h3>AI Recommendation</h3>
        <p className="muted">
          Recommended difficulty: D{historyData?.gamification?.recommendation?.recommendedDifficulty ?? 3}
        </p>
        {historyData?.gamification?.recommendation?.focusTopic ? (
          <p className="muted small">Focus topic: {historyData.gamification.recommendation.focusTopic}</p>
        ) : null}
        <p className="muted small">
          {historyData?.gamification?.recommendation?.reason ?? "Complete more questions to unlock recommendations."}
        </p>
      </div>

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
        {historyData?.topicProgress.length ? (
          <div className="topic-progress-list">
            {historyData.topicProgress.map((topic) => (
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

      <div className="card span-2">
        <h2>Active Missions</h2>
        {historyData?.gamification?.missionProgress?.length ? (
          <div className="topic-progress-list">
            {historyData.gamification.missionProgress.map((mission) => {
              const pct = Math.min(100, Math.round((mission.progress / mission.target) * 100));
              return (
                <div key={`${mission.missionId}-${mission.code}`} className="topic-progress-item">
                  <div className="inline-line">
                    <strong>
                      {mission.name} ({mission.scope})
                    </strong>
                    <span className="muted">
                      {Math.min(mission.progress, mission.target)}/{mission.target} • +{mission.xpReward} XP
                    </span>
                  </div>
                  <p className="muted small">{mission.description}</p>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted">No active missions yet.</p>
        )}
      </div>

      <div className="card span-2">
        <h2>Topic Mastery</h2>
        {historyData?.gamification?.mastery?.length ? (
          <div className="topic-progress-list">
            {historyData.gamification.mastery.map((row) => (
              <div key={row.topicId} className="topic-progress-item">
                <div className="inline-line">
                  <strong>{row.topicName}</strong>
                  <span className="muted">
                    {Math.round(row.masteryScore)}/100 • {row.correctAttempts}/{row.attempts} correct
                  </span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${Math.min(100, Math.round(row.masteryScore))}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Mastery starts tracking after first completed answer.</p>
        )}
      </div>

      <div className="card span-2">
        <h2>Recent Achievements</h2>
        {historyData?.gamification?.achievements?.length ? (
          <div className="topic-progress-list">
            {historyData.gamification.achievements.slice(0, 8).map((achievement) => (
              <div key={`${achievement.code}-${achievement.unlockedAt}`} className="topic-progress-item">
                <div className="inline-line">
                  <strong>{achievement.name}</strong>
                  <span className="muted">+{achievement.xpReward} XP</span>
                </div>
                <p className="muted small">{achievement.description}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No achievements unlocked yet.</p>
        )}
      </div>

      {profile?.is_admin ? (
        <div className="card">
          <h3>Admin Access</h3>
          <p className="muted">Manage topics, questions, and platform metrics.</p>
          <Link href="/admin" className="button-link">
            Open Admin Panel
          </Link>
        </div>
      ) : null}

      {status ? <div className="card error">{status}</div> : null}
    </AppShell>
  );
}
