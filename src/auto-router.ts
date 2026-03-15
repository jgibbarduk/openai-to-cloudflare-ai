/**
 * ============================================================================
 * AUTO-ROUTER
 * ============================================================================
 *
 * Multi-signal model routing inspired by NotDiamond's approach.
 * Extracts signals from an incoming request, scores them, and picks the
 * cheapest model tier that satisfies the request's needs.
 *
 * Tiers (score bands from AUTO_ROUTE_SCORE_THRESHOLDS):
 *   cheap    (0 – tool-1)      simple chat, no tools, small context
 *   tool     (tool – advanced-1) tools, coding, structured output, reasoning
 *   advanced (advanced+)        large context, agentic loop, combined signals
 *
 * Each tier draws from a pool of models (AUTO_ROUTE_DEFAULTS) and picks one
 * at random, or defers to an env-var override when set.
 *
 * @module auto-router
 */

import {
  AUTO_ROUTE_DEFAULTS,
  AUTO_ROUTE_SCORE_THRESHOLDS,
  AUTO_ROUTE_THRESHOLDS,
} from './constants';
import type { Env, OpenAiChatCompletionReq } from './types';

// ── Keyword lists ─────────────────────────────────────────────────────────────

const CODE_KEYWORDS = [
  '```', 'function ', 'class ', 'import ', 'export ', 'const ', 'let ', 'var ',
  'def ', '() =>', 'async ', 'await ', '.map(', '.filter(', '.reduce(',
  'interface ', 'type ', 'struct ', 'enum ', '#include', 'public ', 'private ',
];

const REASONING_KEYWORDS = [
  'step by step', 'step-by-step', 'analyze', 'analyse', 'calculate', 'compute',
  'solve', 'prove', 'compare', 'evaluate', 'reasoning', 'mathematical', 'equation',
  'hypothesis', 'conclude', 'infer', 'derive', 'therefore', 'explain why',
  'how does', 'what is the difference', 'pros and cons',
];

// ── Shared helper ─────────────────────────────────────────────────────────────

/**
 * Pick a random entry from a model pool, or return the env override if set.
 * Exported so model-helpers.ts can reuse it for the cheap-fallback path in
 * getCfModelName (which runs without full request context).
 */
export function pickFromPool(envOverride: string | undefined, pool: readonly string[]): string {
  if (envOverride) return envOverride;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Signal extraction ─────────────────────────────────────────────────────────

interface RouteSignals {
  hasTools:            boolean;
  toolCount:           number;
  messageCount:        number;
  totalChars:          number;
  hasCodeContent:      boolean;   // code blocks or programming keywords
  hasReasoningContent: boolean;   // math/logic/analysis keywords
  hasAgenticHistory:   boolean;   // role='tool' messages → active agentic loop
  hasStructuredOutput: boolean;   // json_object or json_schema response_format
  toolChoiceRequired:  boolean;   // tool_choice === 'required'
  systemPromptLength:  number;    // characters in system/developer message
}

/** Safely extract text from message content that may be a string or content-part array. */
function getContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(p => (typeof p === 'string' ? p : ((p as any).text ?? ''))).join(' ');
  }
  return '';
}

function extractRouteSignals(request: OpenAiChatCompletionReq): RouteSignals {
  const messages = request.messages ?? [];
  const tools    = request.tools ?? [];

  const allText  = messages.map(m => getContentText(m.content)).join(' ').toLowerCase();
  const systemMsg = messages.find(m => m.role === 'system' || m.role === 'developer');

  return {
    hasTools:            tools.length > 0,
    toolCount:           tools.length,
    messageCount:        messages.length,
    totalChars:          allText.length,
    hasCodeContent:      CODE_KEYWORDS.some(kw => allText.includes(kw.toLowerCase())),
    hasReasoningContent: REASONING_KEYWORDS.some(kw => allText.includes(kw)),
    hasAgenticHistory:   messages.some(m => m.role === 'tool'),
    hasStructuredOutput: !!(
      request.response_format &&
      typeof request.response_format === 'object' &&
      (request.response_format.type === 'json_object' || request.response_format.type === 'json_schema')
    ),
    toolChoiceRequired:  request.tool_choice === 'required',
    systemPromptLength:  systemMsg ? getContentText(systemMsg.content).length : 0,
  };
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Convert extracted signals into a numeric routing score.
 *
 * Hard signals (score += 8) escalate directly to advanced on their own.
 * Soft signals combine additively so that e.g. reasoning(+5) + tools(+3) = 8
 * also reaches advanced without requiring a massive context window.
 */
function scoreRouteSignals(s: RouteSignals): number {
  let score = 0;

  // Hard escalations — any one alone → advanced
  if (s.messageCount > AUTO_ROUTE_THRESHOLDS.advancedMessageCount) score += 8;
  if (s.totalChars   > AUTO_ROUTE_THRESHOLDS.advancedTotalChars)   score += 8;
  if (s.toolCount    > AUTO_ROUTE_THRESHOLDS.advancedToolCount)    score += 8;
  if (s.hasAgenticHistory)   score += 8;

  // Moderate signals — combine to escalate tier
  if (s.hasReasoningContent) score += 5;
  if (s.hasTools)            score += 3;
  if (s.toolCount > 2)       score += 2;
  if (s.toolChoiceRequired)  score += 2;
  if (s.hasCodeContent)      score += 3;
  if (s.hasStructuredOutput) score += 3;
  if (s.systemPromptLength > 2000) score += 2;

  return score;
}

/** Compact signal summary for log lines. */
function formatSignals(s: RouteSignals): string {
  const parts: string[] = [];
  if (s.hasTools)            parts.push(`tools=${s.toolCount}`);
  if (s.hasAgenticHistory)   parts.push('agentic');
  if (s.hasCodeContent)      parts.push('code');
  if (s.hasReasoningContent) parts.push('reasoning');
  if (s.hasStructuredOutput) parts.push('json-output');
  if (s.toolChoiceRequired)  parts.push('tool-required');
  parts.push(`msgs=${s.messageCount}`, `chars=${s.totalChars}`);
  return parts.join(', ');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Select the most appropriate Cloudflare model for a request using
 * multi-signal scoring inspired by NotDiamond's routing approach.
 *
 * | Score                         | Tier     | Pool                          |
 * |-------------------------------|----------|-------------------------------|
 * | < AUTO_ROUTE_SCORE_THRESHOLDS.tool     | cheap    | AUTO_ROUTE_DEFAULTS.cheap     |
 * | < AUTO_ROUTE_SCORE_THRESHOLDS.advanced | tool     | AUTO_ROUTE_DEFAULTS.tool      |
 * | ≥ AUTO_ROUTE_SCORE_THRESHOLDS.advanced | advanced | AUTO_ROUTE_DEFAULTS.advanced  |
 *
 * All three pools can be overridden to a single model via env vars:
 * `AUTO_ROUTE_CHEAP_MODELS`, `AUTO_ROUTE_TOOL_MODELS`, `AUTO_ROUTE_ADVANCED_MODELS`.
 *
 * @param request - Normalised OpenAI chat completion request
 * @param env     - Worker environment (for model overrides)
 * @returns Cloudflare Workers AI model identifier
 */
export function resolveAutoRouteModel(request: OpenAiChatCompletionReq, env: Env): string {
  const signals = extractRouteSignals(request);
  const score   = scoreRouteSignals(signals);
  const sig     = formatSignals(signals);

  if (score >= AUTO_ROUTE_SCORE_THRESHOLDS.advanced) {
    const model = pickFromPool(env.AUTO_ROUTE_ADVANCED_MODELS, AUTO_ROUTE_DEFAULTS.advanced);
    console.log(`[AutoRoute] Advanced (score=${score}) → ${model} | ${sig}`);
    return model;
  }

  if (score >= AUTO_ROUTE_SCORE_THRESHOLDS.tool) {
    const model = pickFromPool(env.AUTO_ROUTE_TOOL_MODELS, AUTO_ROUTE_DEFAULTS.tool);
    console.log(`[AutoRoute] Tool (score=${score}) → ${model} | ${sig}`);
    return model;
  }

  const model = pickFromPool(env.AUTO_ROUTE_CHEAP_MODELS, AUTO_ROUTE_DEFAULTS.cheap);
  console.log(`[AutoRoute] Cheap (score=${score}) → ${model}`);
  return model;
}

