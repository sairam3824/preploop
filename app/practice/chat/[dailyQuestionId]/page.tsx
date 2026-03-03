"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/components/api-fetch";
import { AppShell } from "@/components/app-shell";
import { AuthPanel } from "@/components/auth-panel";
import { useAuth } from "@/components/auth-provider";

interface ChatResponse {
  sessionId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export default function ChatPage() {
  const params = useParams<{ dailyQuestionId: string }>();
  const dailyQuestionId = useMemo(() => String(params?.dailyQuestionId ?? ""), [params]);
  const { user, accessToken, loading } = useAuth();

  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken || !dailyQuestionId) return;

    apiFetch<ChatResponse>(`/api/chat?dailyQuestionId=${dailyQuestionId}`, accessToken)
      .then((res) => setMessages(res.messages))
      .catch((error) => setStatus(error.message));
  }, [accessToken, dailyQuestionId]);

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!accessToken || !dailyQuestionId || !draft.trim()) return;

    setSending(true);
    setStatus(null);

    const userMessage = { role: "user" as const, content: draft.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setDraft("");

    try {
      const response = await apiFetch<{ reply: string }>("/api/chat", accessToken, {
        method: "POST",
        body: JSON.stringify({
          dailyQuestionId,
          message: userMessage.content
        })
      });

      setMessages((prev) => [...prev, { role: "assistant", content: response.reply }]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <AppShell title="Practice Chat" subtitle="Loading...">
        <div className="card">Loading...</div>
      </AppShell>
    );
  }

  if (!user || !accessToken) {
    return (
      <AppShell title="Practice Chat" subtitle="Sign in required">
        <AuthPanel />
      </AppShell>
    );
  }

  return (
    <AppShell title="Dedicated Coaching Chat" subtitle="Context is saved per question.">
      <div className="card span-2">
        <div className="inline-actions">
          <Link href="/practice" className="button-link ghost">
            Back to Practice
          </Link>
        </div>
        <div className="chat-box">
          {messages.length === 0 ? <p className="muted">No messages yet. Ask for guidance.</p> : null}
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={message.role === "user" ? "bubble user" : "bubble assistant"}>
              <span className="bubble-role">{message.role === "user" ? "You" : "Coach"}</span>
              <p>{message.content}</p>
            </div>
          ))}
        </div>

        <form className="stack" onSubmit={sendMessage}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask for feedback, structure, or next-step hints..."
            rows={4}
            required
          />
          <button type="submit" disabled={sending || !draft.trim()}>
            {sending ? "Sending..." : "Send"}
          </button>
        </form>

        {status ? <div className="status">{status}</div> : null}
      </div>
    </AppShell>
  );
}
