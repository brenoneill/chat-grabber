// Prices in USD per 1,000,000 tokens.
// Add new models here as they ship; resolveModel does a longest-prefix match,
// so dated variants like "claude-opus-4-7-20251022" map to "claude-opus-4-7".
export const PRICING = {
  'claude-opus-4-7':   { input:  5.0, output: 25.0, cacheRead: 0.5,  cacheWrite:  6.25, cacheWrite1h: 10.0 },
  'claude-opus-4-6':   { input:  5.0, output: 25.0, cacheRead: 0.5,  cacheWrite:  6.25, cacheWrite1h: 10.0 },
  'claude-opus-4-5':   { input:  5.0, output: 25.0, cacheRead: 0.5,  cacheWrite:  6.25, cacheWrite1h: 10.0 },
  'claude-opus-4-1':   { input: 15.0, output: 75.0, cacheRead: 1.5,  cacheWrite: 18.75, cacheWrite1h: 30.0 },
  'claude-opus-4':     { input: 15.0, output: 75.0, cacheRead: 1.5,  cacheWrite: 18.75, cacheWrite1h: 30.0 },
  'claude-sonnet-4-6': { input:  3.0, output: 15.0, cacheRead: 0.3,  cacheWrite:  3.75, cacheWrite1h:  6.0 },
  'claude-sonnet-4-5': { input:  3.0, output: 15.0, cacheRead: 0.3,  cacheWrite:  3.75, cacheWrite1h:  6.0 },
  'claude-sonnet-4':   { input:  3.0, output: 15.0, cacheRead: 0.3,  cacheWrite:  3.75, cacheWrite1h:  6.0 },
  'claude-3-7-sonnet': { input:  3.0, output: 15.0, cacheRead: 0.3,  cacheWrite:  3.75, cacheWrite1h:  6.0 },
  'claude-3-5-sonnet': { input:  3.0, output: 15.0, cacheRead: 0.3,  cacheWrite:  3.75, cacheWrite1h:  6.0 },
  'claude-haiku-4-5':  { input:  1.0, output:  5.0, cacheRead: 0.1,  cacheWrite:  1.25, cacheWrite1h:  2.0 },
  'claude-3-5-haiku':  { input:  0.8, output:  4.0, cacheRead: 0.08, cacheWrite:  1.0,  cacheWrite1h:  1.6 },
};

const SORTED_KEYS = Object.keys(PRICING).sort((a, b) => b.length - a.length);

export function resolveModel(name) {
  if (!name) return null;
  if (PRICING[name]) return { key: name, rates: PRICING[name] };
  for (const key of SORTED_KEYS) {
    if (name.startsWith(key)) return { key, rates: PRICING[key] };
  }
  return null;
}

// tokens shape: { input, output, cacheCreation, cacheRead }
// cacheCreation is priced at the 5-minute cacheWrite rate; Claude Code's JSONL
// does not distinguish 5-minute from 1-hour cache creation today.
export function costForTokens(tokens, rates) {
  return (
    (tokens.input ?? 0) * rates.input +
    (tokens.output ?? 0) * rates.output +
    (tokens.cacheRead ?? 0) * rates.cacheRead +
    (tokens.cacheCreation ?? 0) * rates.cacheWrite
  ) / 1_000_000;
}

// tokensByModel: { [modelName]: tokens }
// Returns { cost, unknownModels: string[] }.
export function costForSession(tokensByModel) {
  let cost = 0;
  const unknownModels = [];
  for (const [model, tokens] of Object.entries(tokensByModel || {})) {
    const resolved = resolveModel(model);
    if (!resolved) {
      if ((tokens.input || tokens.output || tokens.cacheRead || tokens.cacheCreation) > 0) {
        unknownModels.push(model);
      }
      continue;
    }
    cost += costForTokens(tokens, resolved.rates);
  }
  return { cost, unknownModels };
}
