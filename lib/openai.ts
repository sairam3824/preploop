import OpenAI from "openai";
import { getEnv } from "@/lib/env";

let client: OpenAI | null = null;

export function getOpenAIClient() {
  if (client) {
    return client;
  }

  const env = getEnv();
  client = new OpenAI({ apiKey: env.openAiApiKey });
  return client;
}

export function getModelName() {
  return getEnv().openAiModel;
}
