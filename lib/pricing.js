// Token pricing for the cost estimate shown per agent.
//
// These are Anthropic API list prices (USD per million tokens) as of 2026-10. Subscription users
// (Pro/Max/Team) don't pay per token, so for them this is an API-equivalent estimate, not a bill.
//
// Cache writes are priced off the input rate: 5-minute = 1.25x input, 1-hour = 2x input.
// `fast` is the multiplier applied to every component when usage.speed === 'fast'; models without
// one have no published fast price, so a fast-mode message on them is reported as unknown.

const M = 1_000_000;

export const PRICES = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, context: 1_000_000 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1.0, context: 1_000_000 },
  'claude-mythos-5-1': { input: 10, output: 50, cacheRead: 0.25, context: 1_000_000 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, fast: 2, context: 1_000_000 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, fast: 2, context: 1_000_000 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, context: 1_000_000 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, context: 1_000_000 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, context: 1_000_000 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, context: 1_000_000 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, context: 1_000_000 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, context: 1_000_000 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, context: 1_000_000 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, context: 200_000 },
};

const DEFAULT_CONTEXT = 200_000;
const KEYS = Object.keys(PRICES).sort((a, b) => b.length - a.length); // longest prefix wins

// "us.anthropic.claude-opus-5-5-20260101-v1:0[1m]" -> "claude-opus-5-5"
export function normalizeModel(model = '') {
  let m = String(model).toLowerCase().trim();
  m = m.replace(/\[[^\]]*\]$/, ''); // [1m]
  const i = m.indexOf('claude-');
  if (i > 0) m = m.slice(i); // anthropic. / us.anthropic. / vertex paths
  m = m.replace(/(-v\d+(:\d+)?)$/, ''); // bedrock -v1:0
  m = m.replace(/[-@]\d{8}$/, ''); // date suffix
  return m;
}

export function priceOf(model) {
  const m = normalizeModel(model);
  const key = KEYS.find((k) => m === k || m.startsWith(k + '-'));
  return key ? PRICES[key] : null;
}

export function contextWindowOf(model) {
  return priceOf(model)?.context || DEFAULT_CONTEXT;
}

// USD cost of one API message's usage, or null if the model (or its fast mode) isn't priced.
export function costOf(model, usage) {
  const p = priceOf(model);
  if (!p || !usage) return null;
  let mult = 1;
  if (usage.speed === 'fast') {
    if (!p.fast) return null;
    mult = p.fast;
  }
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const cc = usage.cache_creation;
  let w5 = n(usage.cache_creation_input_tokens), w1h = 0;
  if (cc && typeof cc === 'object' && (cc.ephemeral_5m_input_tokens != null || cc.ephemeral_1h_input_tokens != null)) {
    w5 = n(cc.ephemeral_5m_input_tokens);
    w1h = n(cc.ephemeral_1h_input_tokens);
  }
  const usd = n(usage.input_tokens) * p.input
    + n(usage.output_tokens) * p.output
    + n(usage.cache_read_input_tokens) * p.cacheRead
    + w5 * p.input * 1.25
    + w1h * p.input * 2;
  return (usd * mult) / M;
}
