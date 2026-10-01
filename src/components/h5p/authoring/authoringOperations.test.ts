import { expect, test } from 'vitest';
import { mergeAuthoringOperations } from './authoringOperations';
import type { AuthoringOperation } from '../../../services/api';
test('completion survives stale snapshot replay and is not duplicated', () => {
  const start: AuthoringOperation = { id: 'item', runId: 'turn', name: 'review', label: 'Check', status: 'running', startedAt: '2026-10-01T10:00:00Z' };
  const end = { ...start, status: 'completed' as const, durationMs: 2000 };
  expect(mergeAuthoringOperations([end], [start])).toEqual([end]);
  expect(mergeAuthoringOperations([start], [end, end])).toEqual([end]);
});
