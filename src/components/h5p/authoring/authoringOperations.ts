import type { AuthoringOperation } from '../../../services/api';

// Snapshots can arrive after newer item events. A saved completion wins over
// a stale running item; replaying either event never creates a duplicate row.
export function mergeAuthoringOperations(previous: AuthoringOperation[] = [], incoming: AuthoringOperation[] = []) {
  const items = new Map(previous.map(item => [item.id, item]));
  for (const item of incoming) {
    const saved = items.get(item.id);
    if (saved && saved.status !== 'running' && item.status === 'running') continue;
    items.set(item.id, item);
  }
  return [...items.values()].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)).slice(-200);
}
