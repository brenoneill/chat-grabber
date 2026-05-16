const VALID_KEYS = new Set(['tool', 'branch', 'cwd', 'project', 'session', 'version', 'date', 'diffs']);
const VALID_TOOLS = new Set(['claude-code', 'cursor']);
const TOOL_UNSUPPORTED_KEYS = {
  cursor: new Set(['version']),
};
const DATE_OPERATORS = new Set([':', '=', '>=', '<=', '>', '<']);
const DIFFS_VALUES = new Set(['diffs', 'no-diffs']);

export function parseQuery(argv) {
  const spec = {
    tool: null,
    branch: [],
    cwd: [],
    project: [],
    session: [],
    version: [],
    date: {},
    diffs: 'diffs',
  };

  if (!Array.isArray(argv)) {
    throw new Error('parseQuery expects an array of arguments');
  }

  for (const token of argv) {
    if (!token || typeof token !== 'string') {
      throw new Error(`Invalid query token: ${token}`);
    }

    const match = token.match(/^(\w+)(>=|<=|:|=|>|<)(.+)$/);
    if (!match) {
      throw new Error(`Invalid query token: ${token}`);
    }

    const [, key, op, rawValue] = match;
    if (!VALID_KEYS.has(key)) {
      throw new Error(`Unknown query key: ${key}`);
    }

    const value = rawValue.trim();
    if (!value) {
      throw new Error(`Empty value for query token: ${token}`);
    }

    if (key === 'date') {
      if (!DATE_OPERATORS.has(op)) {
        throw new Error(`Invalid date operator in token: ${token}`);
      }
      const normalized = op === ':' ? 'eq' : op === '=' ? 'eq' : op === '>=' ? 'gte' : op === '<=' ? 'lte' : op === '>' ? 'gt' : 'lt';
      spec.date[normalized] = value;
      continue;
    }

    if (op !== ':' && op !== '=') {
      throw new Error(`Operator ${op} not supported for ${key} in token: ${token}`);
    }

    switch (key) {
      case 'tool':
        spec.tool = value;
        break;
      case 'diffs':
        if (!DIFFS_VALUES.has(value)) {
          throw new Error(`Invalid value for diffs (expected "diffs" or "no-diffs"): ${value}`);
        }
        spec.diffs = value;
        break;
      case 'branch':
      case 'cwd':
      case 'project':
      case 'session':
      case 'version':
        spec[key].push(value);
        break;
      default:
        throw new Error(`Unsupported query key: ${key}`);
    }
  }

  if (!spec.tool) {
    throw new Error('Missing required filter: tool');
  }
  if (!VALID_TOOLS.has(spec.tool)) {
    throw new Error(`Unknown tool: ${spec.tool} (expected one of ${[...VALID_TOOLS].join(', ')})`);
  }

  const unsupported = TOOL_UNSUPPORTED_KEYS[spec.tool];
  if (unsupported) {
    for (const key of unsupported) {
      if (spec[key] && spec[key].length > 0) {
        throw new Error(`Filter "${key}:" is not supported for tool:${spec.tool}`);
      }
    }
  }

  // Normalize empty arrays to undefined for easier matcher handling.
  for (const key of ['branch', 'cwd', 'project', 'session', 'version']) {
    if (spec[key].length === 0) {
      delete spec[key];
    }
  }

  if (Object.keys(spec.date).length === 0) {
    delete spec.date;
  }

  return spec;
}
