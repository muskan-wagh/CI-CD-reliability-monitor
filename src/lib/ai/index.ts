import { OpenRouterProvider } from "./openrouter.js";
import { StubProvider } from "./stub.js";
import { AiNotConfiguredError, type AiProvider } from "./types.js";

export * from "./types.js";
export { OpenRouterProvider } from "./openrouter.js";
export { StubProvider } from "./stub.js";

/**
 * Resolve the AI provider from the environment (Phase E abstraction:
 * AI Investigation Service → Provider Adapter → LLM).
 *
 * - AI_PROVIDER=openrouter + AI_API_KEY + AI_MODEL  → real provider
 * - nothing set + non-production                    → labeled offline stub
 * - production without config                        → throws (503 at route)
 */
export function getAiProvider(env: NodeJS.ProcessEnv = process.env): AiProvider {
  const provider = (env.AI_PROVIDER ?? "").trim().toLowerCase();
  const apiKey = env.AI_API_KEY ?? "";
  const model = env.AI_MODEL ?? "";

  if (provider === "openrouter") {
    if (!apiKey || !model) {
      throw new AiNotConfiguredError();
    }
    return new OpenRouterProvider(apiKey, model);
  }

  // No explicit provider: dev convenience stub, never in production.
  if (!provider && !apiKey && process.env.NODE_ENV !== "production") {
    return new StubProvider();
  }

  throw new AiNotConfiguredError();
}
