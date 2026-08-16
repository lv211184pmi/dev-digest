import { BlastSummary, type ChatMessage, type LLMProvider } from '@devdigest/shared';
import type { RunLogger } from '../../../../platform/run-logger.js';
import type { BlastSummarizer, BlastSummaryResult } from '../../domain-services/ports.js';

/**
 * The one cheap structured call behind `BlastSummarizer`.
 *
 * `BlastSummary` is `{ summary: string }` and nothing else — that is the whole
 * point. The model is handed a node list that has already been computed and
 * asked for prose about it; with a single-field output schema there is no
 * channel through which it could add an endpoint, drop a caller, or contradict
 * a count, even if it tried.
 *
 * Logging goes through the injected `RunLogger` only, never `console` or pino
 * directly, and records sizes/provenance/tokens — never the node contents and
 * never the rendered prompt.
 */
export class LlmBlastSummarizer implements BlastSummarizer {
  constructor(
    private readonly llm: LLMProvider,
    private readonly provider: string,
    private readonly model: string,
    private readonly runLog: RunLogger,
    private readonly sessionId: string,
    private readonly countTokens: (text: string) => number,
  ) {}

  async summarise(messages: ChatMessage[]): Promise<BlastSummaryResult> {
    this.runLog.info(
      `blast: prompt assembled — ${messages.length} message(s), ` +
        `${messages.reduce((n, m) => n + m.content.length, 0)} chars`,
      {
        event: 'prompt_assembly',
        call: 'blast_summary',
        model: `${this.provider}/${this.model}`,
        sections: messages.map((m) => ({
          section: m.role === 'system' ? 'blast-instructions' : 'blast-nodes',
          // The node list is derived from the INDEX, not from anything the PR
          // author wrote — no diff, no source, no PR body reaches this call.
          source: m.role === 'system' ? 'engine' : 'code-index',
          trust: m.role === 'system' ? 'trusted' : 'derived',
          chars: m.content.length,
          tokens: this.countTokens(m.content),
        })),
      },
    );

    const res = await this.llm.completeStructured<BlastSummary>({
      model: this.model,
      schema: BlastSummary,
      schemaName: 'pr_blast_summary',
      messages,
      temperature: 0,
      requireParameters: true,
      sessionId: this.sessionId,
    });

    this.runLog.info(
      `blast: summary derived — ${res.tokensIn} in / ${res.tokensOut} out`,
      {
        event: 'result',
        call: 'blast_summary',
        model: `${this.provider}/${res.model}`,
        tokens_in: res.tokensIn,
        tokens_out: res.tokensOut,
        // `null` for an unpriced model, never 0 — see the port's comment.
        cost_usd: res.costUsd,
      },
    );

    return {
      summary: res.data.summary,
      provider: this.provider,
      model: res.model,
      tokensIn: res.tokensIn,
      tokensOut: res.tokensOut,
      costUsd: res.costUsd,
    };
  }
}
