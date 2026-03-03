"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/components/api-fetch";
import { AppShell } from "@/components/app-shell";
import { AuthPanel } from "@/components/auth-panel";
import { useAuth } from "@/components/auth-provider";

interface ChatHistoryItem {
  sessionId: string;
  dailyQuestionId: string;
  day: string;
  topicName: string;
  prompt: string;
  lastMessage: string;
  lastMessageAt: string;
}

interface ChatHistoryResponse {
  sessions: ChatHistoryItem[];
}

function truncateText(input: string, max = 100) {
  if (input.length <= max) return input;
  return `${input.slice(0, max).trim()}...`;
}

export default function ChatHistoryPage() {
  const { user, accessToken, loading } = useAuth();
  const [sessions, setSessions] = useState<ChatHistoryItem[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  async function loadHistory(token: string) {
    const response = await apiFetch<ChatHistoryResponse>("/api/chat/history", token, { method: "GET" });
    setSessions(response.sessions ?? []);
  }

  useEffect(() => {
    if (!accessToken) return;

    loadHistory(accessToken).catch((error) => setStatus(error.message));
  }, [accessToken]);

  if (loading) {
    return (
      <AppShell title="Chat History" subtitle="Loading...">
        <div className="card">Loading...</div>
      </AppShell>
    );
  }

  if (!user || !accessToken) {
    return (
      <AppShell title="Chat History" subtitle="Sign in required">
        <AuthPanel />
      </AppShell>
    );
  }

  return (
    <AppShell title="Chat History" subtitle="All your saved coaching conversations.">
      {status ? <div className="card error span-2">{status}</div> : null}

      <div className="practice-panel span-2">
        <div className="practice-sidebar-head">
          <h3>Saved Chats</h3>
          <button type="button" className="secondary" onClick={() => loadHistory(accessToken)}>
            Refresh
          </button>
        </div>

        {sessions.length === 0 ? <p className="muted">No chats yet. Start from Practice.</p> : null}

        <div className="chat-history-list">
          {sessions.map((item) => (
            <div key={item.sessionId} className="chat-history-card">
              <div className="inline-line">
                <strong>{item.topicName}</strong>
                <span className="muted small">{item.day}</span>
              </div>
              <p>{truncateText(item.prompt, 110)}</p>
              <p className="muted small">Last message: {truncateText(item.lastMessage || "No messages yet", 140)}</p>
              <div className="inline-actions">
                <Link href={`/practice/chat/${item.dailyQuestionId}`} className="button-link ghost">
                  Open Chat
                </Link>
                <Link href="/practice" className="button-link ghost">
                  Open Practice
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
