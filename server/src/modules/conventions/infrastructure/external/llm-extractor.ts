import { z } from 'zod';
import type { LLMProvider } from '@devdigest/shared';
import {
  CONVENTION_CATEGORIES,
  CONVENTION_EXTRACTION_SCHEMA_NAME,
  LLM_MAX_RETRIES,
  LLM_MAX_TOKENS,
  LLM_TIMEOUT_MS,
} from '../../domain-model/constants.js';
import type {
  ConventionExtractionPrompt,
  ConventionModel,
  ConventionModelResult,
} from '../../domain-services/ports.js';

/**
 * Module-local output schema — NOT a wire DTO, so it stays out of
 * `@devdigest/shared`; a prompt tweak here must never be a cross-package
 * contract change. The `{ conventions: [...] }` wrapper is required because
 * `toJsonSchema` goes through `zodResponseFormat`
 * (`reviewer-core/src/llm/structured.ts`), which needs a top-level object.
 */
export const ConventionExtractionOutput = z.object({
  conventions: z
    .array(
      z.object({
        category: z.enum(CONVENTION_CATEGORIES),
        rule: z.string().min(8).max(300),
        evidence: z.object({
          file: z.string().min(1),
          line: z.number().int().positive(),
          snippet: z.string().min(1).max(600),
        }),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(20),
});
export type ConventionExtractionOutput = z.infer<typeof ConventionExtractionOutput>;

/** The single structured LLM call, via an already-resolved provider + model. */
export class LlmExtractor implements ConventionModel {
  constructor(
    private readonly llm: LLMProvider,
    private readonly provider: string,
    private readonly model: string,
  ) {}

  async extract(prompt: ConventionExtractionPrompt): Promise<ConventionModelResult> {
    const result = await this.llm.completeStructured({
      model: this.model,
      schema: ConventionExtractionOutput,
      schemaName: CONVENTION_EXTRACTION_SCHEMA_NAME,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      temperature: 0,
      maxTokens: LLM_MAX_TOKENS,
      maxRetries: LLM_MAX_RETRIES,
      timeoutMs: LLM_TIMEOUT_MS,
    });

    return {
      conventions: result.data.conventions,
      provider: this.provider,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
    };
  }
}
