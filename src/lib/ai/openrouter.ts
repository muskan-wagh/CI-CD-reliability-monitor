import type { FailureEvidence } from "../evidence.js";
import {
  AiProviderError,
  parseAiResponse,
  redactEvidence,
  type AiInvestigation,
  type AiProvider,
} from "./types.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * OpenRouter adapter (OpenAI-compatible /chat/completions).
 * One API key gives access to many models, including free tiers — a good fit
 * for keeping the MVP at ₹0. The key never leaves the server.
 */
export class OpenRouterProvider implements AiProvider {
  readonly name = "openrouter";
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly baseUrl: string = process.env.AI_BASE_URL?.replace(/\/+$/, "") || DEFAULT_BASE_URL,
  ) {}

  async investigate(evidence: FailureEvidence): Promise<AiInvestigation> {
    const system = [
      "You are a CI failure analyst for Echo.",
      "You receive a structured evidence pack about ONE flaky/failing test.",
      "Respond with ONLY minified JSON matching exactly:",
      '{"summary":string,"classification":"CONFIRMED"|"LIKELY"|"POSSIBLE"|"UNKNOWN","likely_cause":string,"confidence":number,"evidence":string[],"possible_causes":string[],"recommended_actions":string[]}',
      "Rules:",
      "- Base every statement ONLY on the supplied evidence. Never invent files, logs, APIs or causes.",
      "- Distinguish evidence (observed facts) from inference (your hypothesis).",
      '- If the evidence is insufficient, use classification "UNKNOWN", confidence 0, and summary exactly: "Insufficient evidence to determine the root cause."',
      "- confidence is 0..1 and must reflect how well the evidence supports likely_cause.",
    ].join("\n");

    const user = JSON.stringify(redactEvidence(evidence));

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          // OpenRouter attribution headers (recommended).
          "HTTP-Referer": process.env.DASHBOARD_URL || "https://echo.local",
          "X-Title": "Echo",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.2,
          max_tokens: 800,
        }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (err) {
      throw new AiProviderError(`OpenRouter request failed: ${(err as Error).message}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AiProviderError(
        `OpenRouter HTTP ${res.status}: ${body.slice(0, 300)}`,
      );
    }

    const data = (await res.json().catch(() => null)) as
      | { choices?: { message?: { content?: string } }[] }
      | null;
    const content = data?.choices?.[0]?.message?.content ?? "";
    const parsed = parseAiResponse(content);
    if (!parsed) {
      throw new AiProviderError("OpenRouter returned an unparseable response");
    }
    return parsed;
  }
}
