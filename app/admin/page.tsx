"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { apiFetch } from "@/components/api-fetch";
import { AppShell } from "@/components/app-shell";
import { AuthPanel } from "@/components/auth-panel";
import { useAuth } from "@/components/auth-provider";
import { StatsStrip } from "@/components/stats-strip";

interface AdminStats {
  totalQuestions: number;
  totalUsers: number;
  averageScore: number;
}

interface Topic {
  id: string;
  name: string;
  description: string | null;
}

interface Question {
  id: string;
  topic_id: string;
  prompt: string;
  difficulty: number;
  active: boolean;
  key_points: string[];
  ideal_answer: string;
  topic?: {
    id: string;
    name: string;
  };
}

interface QuestionEditor {
  id: string;
  topic_id: string;
  prompt: string;
  ideal_answer: string;
  key_points: string;
  active: boolean;
}

interface ProfileResponse {
  profile: {
    is_admin: boolean;
  };
}

interface QuestionCreateResponse {
  success: boolean;
  difficulty: number;
}

interface BulkUploadResponse {
  success: boolean;
  inserted: number;
  skipped: number;
  invalidRows?: Array<{
    row: number;
    reason: string;
  }>;
}

export default function AdminPage() {
  const { user, accessToken, loading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<QuestionEditor | null>(null);

  const [topicName, setTopicName] = useState("");
  const [topicDescription, setTopicDescription] = useState("");

  const [questionForm, setQuestionForm] = useState({
    topic_id: "",
    prompt: "",
    ideal_answer: "",
    key_points: "",
    active: true
  });

  const [bulkTopicId, setBulkTopicId] = useState("");
  const [bulkActive, setBulkActive] = useState(true);
  const [bulkContent, setBulkContent] = useState("");
  const [bulkFileName, setBulkFileName] = useState<string | null>(null);

  async function refresh() {
    if (!accessToken) return;

    setStatus(null);
    const profile = await apiFetch<ProfileResponse>("/api/profile", accessToken);
    const admin = Boolean(profile.profile?.is_admin);
    setIsAdmin(admin);

    if (!admin) {
      setStatus("You do not have admin permissions.");
      return;
    }

    const [statsRes, topicsRes, questionsRes] = await Promise.all([
      apiFetch<AdminStats>("/api/admin/stats", accessToken),
      apiFetch<{ topics: Topic[] }>("/api/admin/topics", accessToken),
      apiFetch<{ questions: Question[] }>("/api/admin/questions", accessToken)
    ]);

    setStats(statsRes);
    setTopics(topicsRes.topics);
    setQuestions(questionsRes.questions);

    const firstTopicId = topicsRes.topics[0]?.id ?? "";
    if (!questionForm.topic_id && firstTopicId) {
      setQuestionForm((prev) => ({ ...prev, topic_id: firstTopicId }));
    }
    if (!bulkTopicId && firstTopicId) {
      setBulkTopicId(firstTopicId);
    }
  }

  useEffect(() => {
    if (!accessToken) return;

    refresh().catch((error) => setStatus(error.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  async function addTopic(event: FormEvent) {
    event.preventDefault();
    if (!accessToken) return;

    try {
      await apiFetch("/api/admin/topics", accessToken, {
        method: "POST",
        body: JSON.stringify({ name: topicName, description: topicDescription })
      });
      setTopicName("");
      setTopicDescription("");
      await refresh();
      setStatus("Topic created.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create topic.");
    }
  }

  async function addQuestion(event: FormEvent) {
    event.preventDefault();
    if (!accessToken) return;

    try {
      const response = await apiFetch<QuestionCreateResponse>("/api/admin/questions", accessToken, {
        method: "POST",
        body: JSON.stringify(questionForm)
      });
      setQuestionForm((prev) => ({
        ...prev,
        prompt: "",
        ideal_answer: "",
        key_points: "",
        active: true
      }));
      await refresh();
      setStatus(`Question created. AI difficulty: ${response.difficulty}/5.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create question.");
    }
  }

  async function uploadBulkQuestions(event: FormEvent) {
    event.preventDefault();
    if (!accessToken) return;

    if (!bulkContent.trim()) {
      setStatus("Paste JSON/CSV content or select a file to upload.");
      return;
    }

    try {
      const response = await apiFetch<BulkUploadResponse>("/api/admin/questions", accessToken, {
        method: "POST",
        body: JSON.stringify({
          bulk: true,
          topic_id: bulkTopicId,
          active: bulkActive,
          content: bulkContent
        })
      });

      setBulkContent("");
      setBulkFileName(null);
      await refresh();

      const firstInvalid = response.invalidRows?.[0];
      const invalidNote = firstInvalid ? ` First issue: row ${firstInvalid.row} - ${firstInvalid.reason}` : "";
      setStatus(`Bulk upload complete. Inserted ${response.inserted}, skipped ${response.skipped}.${invalidNote}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Bulk upload failed.");
    }
  }

  async function onBulkFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      setBulkContent(content);
      setBulkFileName(file.name);
      setStatus(`Loaded ${file.name}. Review and submit bulk upload.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to read selected file.");
    }
  }

  async function removeQuestion(id: string) {
    if (!accessToken) return;

    try {
      await apiFetch(`/api/admin/questions?id=${id}`, accessToken, { method: "DELETE" });
      await refresh();
      setStatus("Question deleted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to delete question.");
    }
  }

  function startEdit(question: Question) {
    setEditingQuestion({
      id: question.id,
      topic_id: question.topic_id,
      prompt: question.prompt,
      ideal_answer: question.ideal_answer,
      key_points: (question.key_points ?? []).join("\n"),
      active: question.active
    });
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!accessToken || !editingQuestion) return;

    try {
      const response = await apiFetch<{ success: boolean; difficulty: number | null }>("/api/admin/questions", accessToken, {
        method: "PUT",
        body: JSON.stringify(editingQuestion)
      });
      setEditingQuestion(null);
      await refresh();
      if (typeof response.difficulty === "number") {
        setStatus(`Question updated. AI difficulty recalculated: ${response.difficulty}/5.`);
      } else {
        setStatus("Question updated.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to update question.");
    }
  }

  if (loading) {
    return (
      <AppShell title="Admin" subtitle="Loading...">
        <div className="card">Loading...</div>
      </AppShell>
    );
  }

  if (!user || !accessToken) {
    return (
      <AppShell title="Admin" subtitle="Sign in required">
        <AuthPanel />
      </AppShell>
    );
  }

  return (
    <AppShell title="Admin Panel" subtitle="Manage topics, questions, and metrics.">
      {isAdmin && stats ? (
        <StatsStrip
          items={[
            { label: "Questions", value: stats.totalQuestions },
            { label: "Users", value: stats.totalUsers },
            { label: "Avg Score", value: stats.averageScore }
          ]}
        />
      ) : null}

      <div className="card">
        <h2>Add Topic</h2>
        <form className="stack" onSubmit={addTopic}>
          <input
            value={topicName}
            onChange={(event) => setTopicName(event.target.value)}
            placeholder="Topic name"
            required
          />
          <textarea
            value={topicDescription}
            onChange={(event) => setTopicDescription(event.target.value)}
            placeholder="Description"
            rows={3}
          />
          <button type="submit" disabled={!isAdmin}>
            Add Topic
          </button>
        </form>
      </div>

      <div className="card span-2">
        <h2>Add Question</h2>
        <p className="muted small">Difficulty is auto-generated by OpenAI based on prompt, key points, and ideal answer.</p>
        <form className="stack" onSubmit={addQuestion}>
          <select
            value={questionForm.topic_id}
            onChange={(event) => setQuestionForm((prev) => ({ ...prev, topic_id: event.target.value }))}
            required
          >
            <option value="">Select topic</option>
            {topics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.name}
              </option>
            ))}
          </select>

          <textarea
            value={questionForm.prompt}
            onChange={(event) => setQuestionForm((prev) => ({ ...prev, prompt: event.target.value }))}
            placeholder="Question prompt"
            rows={4}
            required
          />

          <textarea
            value={questionForm.ideal_answer}
            onChange={(event) => setQuestionForm((prev) => ({ ...prev, ideal_answer: event.target.value }))}
            placeholder="Ideal answer"
            rows={5}
            required
          />

          <textarea
            value={questionForm.key_points}
            onChange={(event) => setQuestionForm((prev) => ({ ...prev, key_points: event.target.value }))}
            placeholder="Key points (one per line)"
            rows={4}
          />

          <label className="inline-line">
            <input
              type="checkbox"
              checked={questionForm.active}
              onChange={(event) => setQuestionForm((prev) => ({ ...prev, active: event.target.checked }))}
            />
            Active
          </label>

          <button type="submit" disabled={!isAdmin}>
            Add Question
          </button>
        </form>
      </div>

      {editingQuestion ? (
        <div className="card span-2">
          <h2>Edit Question</h2>
          <p className="muted small">Saving edits will automatically re-evaluate question difficulty with OpenAI.</p>
          <form className="stack" onSubmit={saveEdit}>
            <select
              value={editingQuestion.topic_id}
              onChange={(event) =>
                setEditingQuestion((prev) => (prev ? { ...prev, topic_id: event.target.value } : prev))
              }
              required
            >
              <option value="">Select topic</option>
              {topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.name}
                </option>
              ))}
            </select>

            <textarea
              value={editingQuestion.prompt}
              onChange={(event) =>
                setEditingQuestion((prev) => (prev ? { ...prev, prompt: event.target.value } : prev))
              }
              rows={4}
              required
            />

            <textarea
              value={editingQuestion.ideal_answer}
              onChange={(event) =>
                setEditingQuestion((prev) => (prev ? { ...prev, ideal_answer: event.target.value } : prev))
              }
              rows={5}
              required
            />

            <textarea
              value={editingQuestion.key_points}
              onChange={(event) =>
                setEditingQuestion((prev) => (prev ? { ...prev, key_points: event.target.value } : prev))
              }
              rows={4}
            />

            <label className="inline-line">
              <input
                type="checkbox"
                checked={editingQuestion.active}
                onChange={(event) =>
                  setEditingQuestion((prev) => (prev ? { ...prev, active: event.target.checked } : prev))
                }
              />
              Active
            </label>

            <div className="inline-actions">
              <button type="submit" disabled={!isAdmin}>
                Save Changes
              </button>
              <button type="button" className="secondary" onClick={() => setEditingQuestion(null)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="card span-2">
        <h2>Questions</h2>
        {questions.length === 0 ? <p className="muted">No questions yet.</p> : null}
        <div className="admin-list">
          {questions.map((question) => (
            <div key={question.id} className="admin-item">
              <div>
                <strong>{question.prompt}</strong>
                <p className="muted small">
                  {question.topic?.name ?? "Unknown"} • Difficulty {question.difficulty} •{" "}
                  {question.active ? "Active" : "Inactive"}
                </p>
              </div>
              <div className="inline-actions">
                <button className="secondary" onClick={() => startEdit(question)} disabled={!isAdmin}>
                  Edit
                </button>
                <button className="danger" onClick={() => removeQuestion(question.id)} disabled={!isAdmin}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card span-2">
        <h2>Bulk Upload</h2>
        <p className="muted small">
          Upload a file or paste JSON/CSV. Supported columns/keys: topic_id or topic, prompt, ideal_answer, key_points,
          active.
        </p>
        <form className="stack" onSubmit={uploadBulkQuestions}>
          <select value={bulkTopicId} onChange={(event) => setBulkTopicId(event.target.value)}>
            <option value="">Fallback topic (required if rows do not include topic)</option>
            {topics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.name}
              </option>
            ))}
          </select>

          <input type="file" accept=".json,.csv,.txt" onChange={onBulkFileChange} />
          {bulkFileName ? <p className="muted small">Selected file: {bulkFileName}</p> : null}

          <textarea
            value={bulkContent}
            onChange={(event) => setBulkContent(event.target.value)}
            placeholder={`CSV example:
topic,prompt,ideal_answer,key_points,active
JavaScript,What is event loop?,It manages async callbacks,call stack|microtasks|macrotasks,true

JSON example:
[{"topic":"JavaScript","prompt":"What is closure?","ideal_answer":"...","key_points":["scope","function"],"active":true}]`}
            rows={12}
            required
          />

          <label className="inline-line">
            <input type="checkbox" checked={bulkActive} onChange={(event) => setBulkActive(event.target.checked)} />
            Mark inserted questions as active by default
          </label>

          <button type="submit" disabled={!isAdmin}>
            Upload in Bulk
          </button>
        </form>
      </div>

      {status ? <div className="card status">{status}</div> : null}
    </AppShell>
  );
}
