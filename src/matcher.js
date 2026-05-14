function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const tokens = escaped.split('**').map((part) => part.replace(/\*/g, '[^/]*'));
  return new RegExp(`^${tokens.join('.*')}$`, 'i');
}

function matchesGlob(value, pattern) {
  if (pattern === value) {
    return true;
  }
  const regex = globToRegExp(pattern);
  return regex.test(value);
}

function isoDatePart(value) {
  if (!value || typeof value !== 'string') return null;
  const date = value.slice(0, 10);
  return date.match(/^\d{4}-\d{2}-\d{2}$/) ? date : null;
}

export function match(filter, session) {
  if (filter.tool && filter.tool !== 'claude-code') {
    return false;
  }

  if (filter.branch) {
    if (!session.gitBranch) {
      return false;
    }
    const branchMatch = filter.branch.some((pattern) => matchesGlob(session.gitBranch, pattern));
    if (!branchMatch) return false;
  }

  if (filter.cwd) {
    if (!session.cwd) return false;
    const cwdLower = session.cwd.toLowerCase();
    const anyCwd = filter.cwd.some((token) => cwdLower.includes(token.toLowerCase()));
    if (!anyCwd) return false;
  }

  if (filter.project) {
    const anyProject = filter.project.some((token) => token === session.projectFolder);
    if (!anyProject) return false;
  }

  if (filter.session) {
    const anySession = filter.session.some((token) => session.sessionId.startsWith(token));
    if (!anySession) return false;
  }

  if (filter.version) {
    const anyVersion = filter.version.some((token) => token === session.version);
    if (!anyVersion) return false;
  }

  if (filter.date) {
    const started = isoDatePart(session.startedAt);
    if (!started) return false;
    if (filter.date.eq && started !== filter.date.eq) return false;
    if (filter.date.gte && started < filter.date.gte) return false;
    if (filter.date.lte && started > filter.date.lte) return false;
    if (filter.date.gt && started <= filter.date.gt) return false;
    if (filter.date.lt && started >= filter.date.lt) return false;
  }

  return true;
}
