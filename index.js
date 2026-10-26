/**
 * Host half of the dsh-prompt-optimizer bundle.
 *
 * Rewrites a draft with a real model call, exposed to the Client through a
 * hand-written Typert Remote namespace.
 *
 * Why hand-written: the official `@Remote` route normally goes through
 * `dsh-typert-generator`, but `createTypertRemoteInfo(spec, zod)` takes a plain
 * object — the generated file is itself just that object. Writing it by hand
 * avoids a build step entirely while producing the identical runtime shape.
 *
 * Boundaries that matter:
 *  - `llm` is read with `ctx.get('llm')` and an undefined check. A hard
 *    `inject: ['llm']` makes the whole bundle fail to load when it is absent.
 *  - Nothing outside this package is imported.
 *  - Every failure is thrown as `RemoteError` so the code crosses the wire
 *    intact instead of folding to `internal`.
 */

import { z } from 'zod';

/**
 * One Remote failure carrying a stable code.
 *
 * Re-declared here instead of imported: `@deepseek-ai/dsh-typert-protocol` does
 * not resolve from a profile-installed package, and a hard import would take
 * the whole Host half down. Discrimination is by `code` and the structural
 * `isDSHRemoteError` marker, never by instanceof, so a local copy crosses the
 * wire identically — that is exactly how the protocol's own class is built.
 */
class RemoteError extends Error {
  constructor(code, message, details, options) {
    super(message, options);
    this.code = code;
    this.details = details;
    this.name = 'RemoteError';
    this.isDSHRemoteError = true;
  }
}

/** Largest draft accepted by one rewrite. */
const MAX_INPUT = 12000;
/** Output cap for the rewritten prompt. */
const MAX_OUTPUT = 1600;
/** End-to-end deadline for one rewrite. */
const DEFAULT_TIMEOUT_MS = 90000;

const SYSTEM_PROMPT = [
  '你是提示词工程师。把用户的草稿改写成一条可以直接发给 AI 执行的高质量提示词。',
  '',
  '要求：',
  '1. 保留用户原意，不要新增他未提出的需求。',
  '2. 用 Markdown 小标题组织：目标、背景（如有）、要求、约束（如有）、输出要求。',
  '3. 约束类句子（「要有…」「不要…」「必须…」）单独归入约束段。',
  '4. 输出要求按任务性质写：写代码要可运行、不要留 TODO；问问题要先答再论。',
  '5. 只输出改写后的提示词本身，不要解释你做了什么，不要用代码块包裹。',
  '6. 语言与用户草稿一致：中文草稿输出中文，英文草稿输出英文。',
].join('\n');

/** Strip a wrapping code fence the model may add despite instructions. */
function unwrap(text) {
  const trimmed = text.trim();
  const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/u.exec(trimmed);
  return fenced === null ? trimmed : fenced[1].trim();
}

/** Clamp the rewrite to the output cap without cutting mid-line. */
function finalize(text) {
  const cleaned = unwrap(text);
  if (cleaned.length <= MAX_OUTPUT) return cleaned;
  const cut = cleaned.slice(0, MAX_OUTPUT);
  const lastBreak = cut.lastIndexOf('\n');
  return (lastBreak > MAX_OUTPUT * 0.6 ? cut.slice(0, lastBreak) : cut).trimEnd();
}

/**
 * Ask the model to rewrite one draft.
 * @param {object} llm - the Harness `llm` service.
 * @param {{ provider: string, model: string }} route
 * @param {string} draft
 * @param {AbortSignal} signal
 * @returns {Promise<string>}
 */
async function rewriteWithModel(llm, route, draft, signal) {
  const prepared = await llm.prepareCall({ provider: route.provider, model: route.model }, signal);

  const chunks = prepared.stream({
    provider: route.provider,
    model: route.model,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [{ type: 'text', text: draft }] }],
    maxTokens: MAX_OUTPUT,
    signal,
  });

  let streamed = '';
  const settled = [];
  let failure;

  for await (const chunk of chunks) {
    if (chunk === null || typeof chunk !== 'object') continue;
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      streamed += chunk.text;
    } else if (chunk.type === 'block-end' && chunk.block?.type === 'text') {
      settled.push(chunk.block.text);
    } else if (chunk.type === 'finish') {
      const reason = chunk.reason;
      if (reason?.kind === 'error' || reason?.kind === 'aborted') failure = reason.failure;
      break;
    }
  }

  if (failure !== undefined) {
    const message = typeof failure.message === 'string' && failure.message !== ''
      ? failure.message
      : String(failure.code ?? 'model call failed');
    throw new RemoteError('optimize/failed', message);
  }

  return finalize(streamed !== '' ? streamed : settled.join(''));
}

/**
 * The `promptOptimizer` namespace the Client mounts.
 *
 * `optimize` is annotated the same way the generated artifacts are: the
 * descriptor records `service: 'promptOptimizer'` and `mode: 'direct'`, so the
 * Gateway resolves the call against this Cordis service and method name.
 */
export class PromptOptimizerService {
  /**
   * @param {object} ctx
   */
  constructor(ctx) {
    this.ctx = ctx;
  }

  /**
   * Rewrite one draft with the session's own model route.
   * @param {string} draft
   * @param {string} provider
   * @param {string} model
   * @param {AbortSignal} [signal]
   * @returns {Promise<string>}
   */
  async optimize(draft, provider, model, signal) {
    if (typeof draft !== 'string' || draft.trim() === '') {
      throw new RemoteError('optimize/empty', 'the draft is empty');
    }
    if (draft.length > MAX_INPUT) {
      throw new RemoteError('optimize/too-long', `the draft exceeds ${MAX_INPUT} characters`);
    }
    if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') {
      throw new RemoteError('optimize/no-route', 'no model route was supplied');
    }

    const llm = this.ctx.get('llm');
    if (llm === undefined || typeof llm.prepareCall !== 'function') {
      throw new RemoteError('optimize/no-llm', 'the llm service is unavailable');
    }

    const caller = signal ?? new AbortController().signal;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const forwardAbort = () => controller.abort();
    caller.addEventListener('abort', forwardAbort, { once: true });

    try {
      const text = await rewriteWithModel(llm, { provider, model }, draft, controller.signal);
      if (text.trim() === '') {
        throw new RemoteError('optimize/empty-result', 'the model returned nothing');
      }
      return text;
    } finally {
      clearTimeout(timer);
      caller.removeEventListener('abort', forwardAbort);
    }
  }
}

/** The schema for the `optimize` result: one string. */
const resultSchema = z.string().describe('the rewritten prompt');

/** One JSON-source string parameter, shaped exactly as the generator emits it. */
function stringParameter(name, description, endpoint) {
  const codec = {
    mode: 'strict',
    typeSymbol: `dsh-prompt-optimizer#${endpoint}:${name}`,
    create: () => z.string(),
    jsonSchema: { type: 'string' },
  };
  return {
    name,
    wire: name,
    description,
    source: 'json',
    codec,
    strictCodec: {
      mode: 'strict',
      typeSymbol: `dsh-prompt-optimizer#${endpoint}:${name}`,
      create: () => z.string(),
      jsonSchema: { type: 'string' },
    },
  };
}

/**
 * The Remote contribution, built by hand in the exact shape
 * `dsh-typert-generator` emits. Registering it here is what makes the Host
 * Gateway claim the endpoint; the Client mounts the same shape so the two
 * sides agree on names and arity. No generator, no build step.
 */
export const TYPERT_REMOTE = {
  package: 'dsh-prompt-optimizer',
  descriptors: [
    {
      id: 'dsh-prompt-optimizer#promptOptimizer/optimize',
      namespace: 'promptOptimizer',
      method: 'optimize',
      service: 'promptOptimizer',
      description: 'Rewrite one composer draft into a structured prompt using the given model route.',
      invocation: { kind: 'direct' },
      parameters: [
        stringParameter('draft', 'the raw composer draft to restructure', 'promptOptimizer/optimize'),
        stringParameter('provider', 'registered provider route of the session model', 'promptOptimizer/optimize'),
        stringParameter('model', 'exact model id of the session model', 'promptOptimizer/optimize'),
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-prompt-optimizer#RewrittenPrompt',
        create: () => resultSchema,
        description: 'the rewritten prompt text',
        jsonSchema: { type: 'string' },
      },
    },
  ],
};

/**
 * Start the Host half: provide the service the Remote namespace dispatches to,
 * then register the endpoint so the Gateway claims it.
 * @param {object} ctx
 */
export function apply(ctx) {
  ctx.provide('promptOptimizer', new PromptOptimizerService(ctx));

  const typert = ctx.get('typert');
  if (typert === undefined || typeof typert.remotes?.register !== 'function') {
    console.error('[prompt-optimizer] the typert registry is unavailable; the endpoint will not be claimed');
    return;
  }

  ctx.effect(
    () => typert.remotes.register(TYPERT_REMOTE),
    'prompt-optimizer: register remote endpoint',
  );
}

export const inject = [];
