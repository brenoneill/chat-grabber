import assert from 'node:assert';
import test from 'node:test';
import { match } from '../src/matcher.js';

const baseSession = {
  sessionId: 'abcdef01',
  projectFolder: 'projectA',
  cwd: '/Users/bren/projectA',
  gitBranch: 'feature/payments',
  version: '0.30.0',
  startedAt: '2026-05-12T08:00:00Z',
};

test('match branch glob', () => {
  assert(match({ tool: 'claude-code', branch: ['feature/*'] }, baseSession));
  assert(!match({ tool: 'claude-code', branch: ['main'] }, baseSession));
});

test('match skips session with missing gitBranch for branch filter', () => {
  const session = { ...baseSession, gitBranch: null };
  assert(!match({ tool: 'claude-code', branch: ['feature/*'] }, session));
});

test('match date range edges', () => {
  assert(match({ tool: 'claude-code', date: { gte: '2026-05-12', lte: '2026-05-12' } }, baseSession));
  assert(!match({ tool: 'claude-code', date: { gt: '2026-05-12' } }, baseSession));
  assert(!match({ tool: 'claude-code', date: { lt: '2026-05-12' } }, baseSession));
});

test('match cwd is case-insensitive', () => {
  assert(match({ tool: 'claude-code', cwd: ['PROJECTa'] }, baseSession));
});
