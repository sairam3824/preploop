import { NextRequest } from "next/server";
import { forbiddenResponse, getAuthContext, routeErrorResponse } from "@/lib/auth";
import { getModelName, getOpenAIClient } from "@/lib/openai";
import { getServiceClient } from "@/lib/supabase/server";

type Difficulty = 1 | 2 | 3 | 4 | 5;

interface QuestionDraft {
  topic_id: string;
  question_number: number;
  prompt: string;
  ideal_answer: string;
  key_points: string[];
  active: boolean;
}

interface BulkRow {
  row: number;
  data: Record<string, unknown>;
}

interface BulkInvalidRow {
  row: number;
  reason: string;
}

function clampDifficulty(value: number): Difficulty {
  const rounded = Math.round(value);
  if (rounded <= 1) return 1;
  if (rounded >= 5) return 5;
  return rounded as Difficulty;
}

function normalizeKeyPoints(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value ?? "")
    .split(/\r?\n|[|;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeQuestionNumber(value: unknown, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return Math.max(1, Math.round(fallback));
  }

  return Math.max(1, Math.round(parsed));
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          return typeof item.text === "string" ? item.text : "";
        }
        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

function parseJsonSafely(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function heuristicDifficulty(draft: Pick<QuestionDraft, "prompt" | "ideal_answer" | "key_points">): Difficulty {
  let score = 2;
  const prompt = draft.prompt.toLowerCase();
  const answer = draft.ideal_answer.toLowerCase();
  const combined = `${prompt} ${answer}`;

  if (draft.prompt.length > 180) score += 1;
  if (draft.prompt.length > 340) score += 1;
  if (draft.key_points.length >= 5) score += 1;
  if (draft.key_points.length <= 1 && draft.prompt.length < 100) score -= 1;

  if (
    /system design|distributed|consisten|latency|throughput|concurrency|kubernetes|microservice|architecture|cache|scalability|partition/i.test(
      combined
    )
  ) {
    score += 1;
  }

  return clampDifficulty(score);
}

async function inferDifficulty(draft: Pick<QuestionDraft, "prompt" | "ideal_answer" | "key_points">): Promise<Difficulty> {
  const fallback = heuristicDifficulty(draft);

  try {
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: getModelName(),
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Classify interview question difficulty from 1 to 5. Return strict JSON with key difficulty (number). 1=very basic recall, 5=advanced multi-step reasoning."
        },
        {
          role: "user",
          content: `Prompt: ${draft.prompt}\nIdeal answer: ${draft.ideal_answer}\nKey points: ${draft.key_points.join(", ")}`
        }
      ]
    });

    const raw = extractTextContent(completion.choices[0]?.message?.content);
    const parsed = parseJsonSafely(raw);

    if (parsed && typeof parsed === "object" && "difficulty" in parsed) {
      const rawDifficulty = Number((parsed as { difficulty: unknown }).difficulty);
      if (!Number.isNaN(rawDifficulty)) {
        return clampDifficulty(rawDifficulty);
      }
    }

    const fallbackMatch = raw.match(/\b([1-5])\b/);
    if (fallbackMatch) {
      return clampDifficulty(Number(fallbackMatch[1]));
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function parseCsvRows(content: string): BulkRow[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parsedRows: string[][] = [];
  let currentField = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];

    if (char === "\"") {
      if (inQuotes && normalized[index + 1] === "\"") {
        currentField += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = "";
      continue;
    }

    if (char === "\n" && !inQuotes) {
      currentRow.push(currentField.trim());
      if (currentRow.some((value) => value.length > 0)) {
        parsedRows.push(currentRow);
      }
      currentRow = [];
      currentField = "";
      continue;
    }

    currentField += char;
  }

  currentRow.push(currentField.trim());
  if (currentRow.some((value) => value.length > 0)) {
    parsedRows.push(currentRow);
  }

  if (parsedRows.length < 2) {
    return [];
  }

  const headers = parsedRows[0].map((header) => header.toLowerCase());
  if (headers.length === 0) {
    return [];
  }

  const rows: BulkRow[] = [];
  for (let index = 1; index < parsedRows.length; index += 1) {
    const values = parsedRows[index];
    const record: Record<string, unknown> = {};

    headers.forEach((header, headerIndex) => {
      record[header] = values[headerIndex] ?? "";
    });

    rows.push({
      row: index + 1,
      data: record
    });
  }

  return rows;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseBulkRows(body: Record<string, unknown>): { rows: BulkRow[]; error?: string } {
  if (Array.isArray(body.items)) {
    const rows = body.items
      .map((item, index) => {
        const record = toRecord(item);
        if (!record) {
          return null;
        }

        return {
          row: index + 1,
          data: record
        } as BulkRow;
      })
      .filter((item): item is BulkRow => Boolean(item));

    if (rows.length === 0) {
      return { rows: [], error: "Bulk items array is empty or invalid." };
    }

    return { rows };
  }

  const content = String(body.content ?? "").trim();
  if (!content) {
    return { rows: [], error: "Bulk content is required." };
  }

  const parsed = parseJsonSafely(content);
  if (parsed) {
    const jsonRows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && "questions" in parsed && Array.isArray((parsed as { questions: unknown }).questions)
        ? (parsed as { questions: unknown[] }).questions
        : [];

    if (jsonRows.length > 0) {
      const rows = jsonRows
        .map((item, index) => {
          const record = toRecord(item);
          if (!record) {
            return null;
          }

          return {
            row: index + 1,
            data: record
          } as BulkRow;
        })
        .filter((item): item is BulkRow => Boolean(item));

      if (rows.length === 0) {
        return { rows: [], error: "Bulk JSON has no valid question objects." };
      }

      return { rows };
    }
  }

  const csvRows = parseCsvRows(content);
  if (csvRows.length === 0) {
    return {
      rows: [],
      error: "Unsupported bulk format. Provide JSON array/object or CSV with headers."
    };
  }

  return { rows: csvRows };
}

function resolveTopicId(
  input: unknown,
  fallbackTopicId: string,
  topicByName: Map<string, string>,
  topicIds: Set<string>
): string {
  if (typeof input === "string" && input.trim()) {
    const trimmed = input.trim();
    const fromName = topicByName.get(trimmed.toLowerCase());
    if (fromName) {
      return fromName;
    }

    if (topicIds.has(trimmed)) {
      return trimmed;
    }
    return "";
  }

  return topicIds.has(fallbackTopicId) ? fallbackTopicId : "";
}

function normalizeBulkRow(
  row: BulkRow,
  fallbackTopicId: string,
  defaultActive: boolean,
  topicByName: Map<string, string>,
  topicIds: Set<string>
): { draft?: QuestionDraft; invalid?: BulkInvalidRow } {
  const topicValue = row.data.topic_id ?? row.data.topic ?? row.data.topic_name ?? row.data.topicName;
  const topic_id = resolveTopicId(topicValue, fallbackTopicId, topicByName, topicIds);

  const promptValue = row.data.prompt ?? row.data.question;
  const answerValue = row.data.ideal_answer ?? row.data.idealAnswer ?? row.data.answer;
  const questionNumberValue =
    row.data.question_number ?? row.data.question_no ?? row.data.questionNumber ?? row.data.questionNo;
  const prompt = typeof promptValue === "string" ? promptValue.trim() : "";
  const ideal_answer = typeof answerValue === "string" ? answerValue.trim() : "";
  const key_points = normalizeKeyPoints(row.data.key_points ?? row.data.keyPoints);
  const question_number = normalizeQuestionNumber(questionNumberValue, Math.max(1, row.row - 1));
  const activeValue = row.data.active;
  const active =
    typeof activeValue === "boolean"
      ? activeValue
      : typeof activeValue === "string"
        ? !["false", "0", "no"].includes(activeValue.trim().toLowerCase())
        : defaultActive;

  if (!topic_id) {
    return {
      invalid: {
        row: row.row,
        reason: "Missing/invalid topic (topic_id or topic name)."
      }
    };
  }

  if (!prompt) {
    return {
      invalid: {
        row: row.row,
        reason: "Missing prompt."
      }
    };
  }

  if (!ideal_answer) {
    return {
      invalid: {
        row: row.row,
        reason: "Missing ideal_answer."
      }
    };
  }

  return {
    draft: {
      topic_id,
      question_number,
      prompt,
      ideal_answer,
      key_points,
      active
    }
  };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (!auth.isAdmin) {
      return forbiddenResponse();
    }

    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("questions")
      .select("*, topic:topics(id, name)")
      .order("topic_id", { ascending: true })
      .order("question_number", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ questions: data ?? [] });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (!auth.isAdmin) {
      return forbiddenResponse();
    }

    const rawBody = await req.json();
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return Response.json({ error: "Invalid request body." }, { status: 400 });
    }

    const body = rawBody as Record<string, unknown>;
    const supabase = getServiceClient();
    const isBulk = body.bulk === true || Array.isArray(body.items);

    if (!isBulk) {
      const draft: QuestionDraft = {
        topic_id: String(body.topic_id ?? "").trim(),
        question_number: normalizeQuestionNumber(body.question_number ?? body.questionNo ?? body.question_no, 1),
        prompt: String(body.prompt ?? "").trim(),
        ideal_answer: String(body.ideal_answer ?? "").trim(),
        key_points: normalizeKeyPoints(body.key_points),
        active: body.active !== false
      };

      if (!draft.topic_id || !draft.prompt || !draft.ideal_answer) {
        return Response.json({ error: "Invalid question payload." }, { status: 400 });
      }

      const difficulty = await inferDifficulty(draft);
      const { error } = await supabase.from("questions").insert({
        ...draft,
        difficulty
      });

      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }

      return Response.json({ success: true, difficulty });
    }

    const parsedBulk = parseBulkRows(body);
    if (parsedBulk.error) {
      return Response.json({ error: parsedBulk.error }, { status: 400 });
    }

    if (parsedBulk.rows.length > 200) {
      return Response.json({ error: "Bulk upload supports up to 200 rows per request." }, { status: 400 });
    }

    const fallbackTopicId = String(body.topic_id ?? "").trim();
    const defaultActive = body.active !== false;

    const { data: topicsData, error: topicsError } = await supabase.from("topics").select("id, name");
    if (topicsError) {
      return Response.json({ error: topicsError.message }, { status: 500 });
    }

    const topics = Array.isArray(topicsData) ? topicsData : [];
    const topicByName = new Map<string, string>();
    const topicIds = new Set<string>();

    topics.forEach((topic) => {
      const id = typeof topic.id === "string" ? topic.id : "";
      const name = typeof topic.name === "string" ? topic.name : "";
      if (!id || !name) return;

      topicIds.add(id);
      topicByName.set(name.toLowerCase(), id);
    });

    const drafts: QuestionDraft[] = [];
    const invalidRows: BulkInvalidRow[] = [];

    parsedBulk.rows.forEach((row) => {
      const normalized = normalizeBulkRow(row, fallbackTopicId, defaultActive, topicByName, topicIds);
      if (normalized.invalid) {
        invalidRows.push(normalized.invalid);
        return;
      }

      if (normalized.draft) {
        drafts.push(normalized.draft);
      }
    });

    if (drafts.length === 0) {
      return Response.json(
        { error: "No valid rows found in bulk upload.", invalidRows: invalidRows.slice(0, 20) },
        { status: 400 }
      );
    }

    const insertRows: Array<QuestionDraft & { difficulty: Difficulty }> = [];
    for (const draft of drafts) {
      const difficulty = await inferDifficulty(draft);
      insertRows.push({
        ...draft,
        difficulty
      });
    }

    const { error } = await supabase.from("questions").insert(insertRows);
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({
      success: true,
      inserted: insertRows.length,
      skipped: invalidRows.length,
      invalidRows: invalidRows.slice(0, 20)
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (!auth.isAdmin) {
      return forbiddenResponse();
    }

    const rawBody = await req.json();
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return Response.json({ error: "Invalid request body." }, { status: 400 });
    }

    const body = rawBody as Record<string, unknown>;
    const id = String(body.id ?? "");

    if (!id) {
      return Response.json({ error: "Question id is required." }, { status: 400 });
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    };

    if (typeof body.topic_id === "string") updatePayload.topic_id = body.topic_id.trim();
    if (body.question_number !== undefined || body.questionNo !== undefined || body.question_no !== undefined) {
      updatePayload.question_number = normalizeQuestionNumber(body.question_number ?? body.questionNo ?? body.question_no);
    }
    if (typeof body.prompt === "string") updatePayload.prompt = body.prompt.trim();
    if (typeof body.ideal_answer === "string") updatePayload.ideal_answer = body.ideal_answer.trim();
    if (typeof body.active === "boolean") updatePayload.active = body.active;
    if (body.key_points !== undefined) {
      updatePayload.key_points = normalizeKeyPoints(body.key_points);
    }

    const shouldRecomputeDifficulty =
      typeof body.prompt === "string" ||
      typeof body.ideal_answer === "string" ||
      body.key_points !== undefined ||
      body.recomputeDifficulty === true;

    const supabase = getServiceClient();

    if (shouldRecomputeDifficulty) {
      const { data: existingData, error: existingError } = await supabase
        .from("questions")
        .select("prompt, ideal_answer, key_points")
        .eq("id", id)
        .single();

      if (existingError || !existingData) {
        return Response.json({ error: "Question not found." }, { status: 404 });
      }

      const existing = existingData as Record<string, unknown>;
      const fallbackPrompt = typeof existing.prompt === "string" ? existing.prompt : "";
      const fallbackIdeal = typeof existing.ideal_answer === "string" ? existing.ideal_answer : "";

      const promptForDifficulty =
        typeof updatePayload.prompt === "string" ? (updatePayload.prompt as string) : fallbackPrompt;
      const idealForDifficulty =
        typeof updatePayload.ideal_answer === "string" ? (updatePayload.ideal_answer as string) : fallbackIdeal;
      const keyPointsForDifficulty = Array.isArray(updatePayload.key_points)
        ? (updatePayload.key_points as string[])
        : normalizeKeyPoints(existing.key_points);

      if (!promptForDifficulty || !idealForDifficulty) {
        return Response.json({ error: "Question prompt and ideal answer are required." }, { status: 400 });
      }

      updatePayload.difficulty = await inferDifficulty({
        prompt: promptForDifficulty,
        ideal_answer: idealForDifficulty,
        key_points: keyPointsForDifficulty
      });
    }

    const { error } = await supabase.from("questions").update(updatePayload).eq("id", id);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true, difficulty: updatePayload.difficulty ?? null });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (!auth.isAdmin) {
      return forbiddenResponse();
    }

    const questionId = req.nextUrl.searchParams.get("id");

    if (!questionId) {
      return Response.json({ error: "Question id is required." }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { error } = await supabase.from("questions").delete().eq("id", questionId);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
