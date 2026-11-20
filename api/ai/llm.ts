/**
 * llm.ts — Claude integration for statement extraction, classification, and
 * attorney-review drafting.
 *
 * Design rules:
 *   - Every AI path has a deterministic fallback in the caller, so the portal
 *     keeps working (rule engine, template letters) when AI is unavailable.
 *   - Source documents are sent to Claude natively (PDF document blocks and
 *     image blocks), never as a lossy `bytes.toString()` dump.
 *   - Structured extraction uses structured outputs validated by Zod.
 *   - Server-side refusal fallbacks are enabled; a refusal is surfaced as
 *     AiUnavailable rather than silently returning empty text.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type * as z from "zod/v4";
import { env } from "../lib/env";
import { log } from "../lib/logger";

const BETAS = ["server-side-fallback-2026-07-01"];

export type Attachment = { bytes: Uint8Array; contentType: string; title: string };
export type Effort = "low" | "medium" | "high";

export type AiFailure = "disabled" | "transient" | "refused" | "misconfigured" | "invalid";

export class AiUnavailable extends Error {
  readonly reason: AiFailure;
  constructor(message: string, reason: AiFailure) {
    super(message);
    this.name = "AiUnavailable";
    this.reason = reason;
  }
}

let client: Anthropic | undefined;
function getClient(): Anthropic {
  if (env.aiDisabled) throw new AiUnavailable("AI analysis is disabled on this server.", "disabled");
  client ??= new Anthropic({ maxRetries: 2, timeout: 5 * 60 * 1000 });
  return client;
}

export function aiConfigured(): boolean {
  return !env.aiDisabled && Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
}

function toBlocks(attachments: Attachment[]): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const file of attachments) {
    const data = Buffer.from(file.bytes).toString("base64");
    if (file.contentType === "application/pdf") {
      blocks.push({ type: "document", title: file.title, source: { type: "base64", media_type: "application/pdf", data } });
    } else if (/^image\/(png|jpeg|gif|webp)$/.test(file.contentType)) {
      blocks.push({ type: "image", source: { type: "base64", media_type: file.contentType as "image/png", data } });
    } else {
      blocks.push({ type: "document", title: file.title, source: { type: "text", media_type: "text/plain", data: Buffer.from(file.bytes).toString("utf8") } });
    }
  }
  return blocks;
}

function mapError(error: unknown): AiUnavailable {
  if (error instanceof AiUnavailable) return error;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiUnavailable("AI credentials are missing or invalid.", "misconfigured");
  }
  if (error instanceof Anthropic.BadRequestError) return new AiUnavailable("The document could not be analyzed.", "invalid");
  if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError || error instanceof Anthropic.APIConnectionError) {
    return new AiUnavailable("AI service is temporarily busy. Please retry shortly.", "transient");
  }
  if (error instanceof Anthropic.APIError) return new AiUnavailable(`AI service error (${error.status ?? "unknown"}).`, "transient");
  if (error instanceof Error && /credentials|api key|apiKey/i.test(error.message)) {
    return new AiUnavailable("AI is not configured on this server (set ANTHROPIC_API_KEY).", "misconfigured");
  }
  return new AiUnavailable("AI service is unavailable.", "transient");
}

function textOf(message: Anthropic.Beta.BetaMessage): string {
  if (message.stop_reason === "refusal") throw new AiUnavailable("The AI declined this request.", "refused");
  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("").trim();
}

export async function generateDraft(opts: {
  system: string;
  prompt: string;
  attachments?: Attachment[];
  effort?: Effort;
  maxTokens?: number;
}): Promise<string> {
  try {
    const message = await getClient().beta.messages.create({
      model: env.anthropicModel,
      max_tokens: opts.maxTokens ?? 16000,
      betas: BETAS,
      fallbacks: "default",
      output_config: { effort: opts.effort ?? "high" },
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [...toBlocks(opts.attachments ?? []), { type: "text", text: opts.prompt }] }],
    });
    return textOf(message);
  } catch (error) {
    const mapped = mapError(error);
    log.warn("ai draft failed", { reason: mapped.reason, error: error instanceof Error ? error.message : String(error) });
    throw mapped;
  }
}

export async function extractStructured<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  prompt: string;
  attachments?: Attachment[];
  effort?: Effort;
}): Promise<z.infer<S>> {
  try {
    const message = await getClient().beta.messages.parse({
      model: env.anthropicModel,
      max_tokens: 16000,
      betas: BETAS,
      fallbacks: "default",
      output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
      system: opts.system,
      messages: [{ role: "user", content: [...toBlocks(opts.attachments ?? []), { type: "text", text: opts.prompt }] }],
    });
    if (message.stop_reason === "refusal") throw new AiUnavailable("The AI declined this request.", "refused");
    if (message.parsed_output == null) throw new AiUnavailable("The AI response could not be parsed.", "invalid");
    return message.parsed_output as z.infer<S>;
  } catch (error) {
    const mapped = mapError(error);
    log.warn("ai extraction failed", { reason: mapped.reason, error: error instanceof Error ? error.message : String(error) });
    throw mapped;
  }
}
