/**
 * Thin wrapper around @anthropic-ai/sdk that constructs the request with:
 *   - system message split into (a) instructions and (b) policy corpus
 *   - prompt caching enabled on the policy block (this is a ~55K-token
 *     block that never changes; caching drops per-call cost by ~90%)
 *
 * Used identically by the API route and the eval runner.
 */

import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "./prompt";

const client = new Anthropic();

export interface ClaudeResponse {
  text: string;
  usage: {
    input_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens: number;
  };
  stop_reason: string | null;
  latency_ms: number;
}

export async function callClaude(
  systemPromptInstructions: string,
  policyCorpus: string,
  userMessage: string,
): Promise<ClaudeResponse> {
  const start = Date.now();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: [
      { type: "text", text: systemPromptInstructions },
      {
        type: "text",
        text: `<policy_sections>\n${policyCorpus}\n</policy_sections>`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return {
    text,
    usage: {
      input_tokens: response.usage.input_tokens,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
      output_tokens: response.usage.output_tokens,
    },
    stop_reason: response.stop_reason,
    latency_ms: Date.now() - start,
  };
}
