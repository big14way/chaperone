// Model selection: NEAR AI Cloud (OpenAI-compatible) when NEAR_AI_API_KEY is set, else Anthropic
// when ANTHROPIC_API_KEY is set, else none (the scripted agent runs instead).
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export interface ModelChoice {
  model: LanguageModel;
  label: string;
}

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
export const DEFAULT_NEAR_AI_MODEL = "anthropic/claude-sonnet-5-5";
export const NEAR_AI_BASE_URL = "https://cloud-api.near.ai/v1";

export function pickModel(env: NodeJS.ProcessEnv = process.env): ModelChoice | null {
  if (env.CHAPERONE_SCRIPTED_AGENT === "1") return null;
  if (env.NEAR_AI_API_KEY) {
    const id = env.NEAR_AI_MODEL || DEFAULT_NEAR_AI_MODEL;
    const nearai = createOpenAICompatible({
      name: "nearai",
      baseURL: env.NEAR_AI_BASE_URL || NEAR_AI_BASE_URL,
      apiKey: env.NEAR_AI_API_KEY,
    });
    return { model: nearai.chatModel(id), label: `NEAR AI Cloud ${id}` };
  }
  if (env.ANTHROPIC_API_KEY) {
    const id = env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
    const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
    return { model: anthropic(id), label: `Anthropic ${id}` };
  }
  return null;
}
