import { describe, expect, test } from '@jest/globals';
import { buildUserContentStats } from '../../services/adminContentStats.js';

describe('admin current content statistics', () => {
  test('joins counts by owner, ignores stale lifetime counters and ranks the real totals', () => {
    const users = [
      { _id: 'a', cwlId: 'alice', stats: { questionsCreated: 999 } },
      { _id: 'b', cwlId: 'bob', stats: { questionsCreated: 0 } },
      { _id: 'c', cwlId: 'carol' }
    ];
    const result = buildUserContentStats(users, {
      folders: [{ _id: 'b', count: 1 }],
      quizzes: [{ _id: 'b', count: 2 }],
      questions: [{ _id: 'b', count: 5 }, { _id: 'a', count: 1 }, { _id: null, count: 8 }]
    });
    expect(result.map(user => [user.cwlId, user.questionsCreated])).toEqual([['bob', 5], ['alice', 1], ['carol', 0]]);
    expect(result[0]).toMatchObject({ coursesCreated: 1, quizzesGenerated: 2 });
    expect(result[2]).toMatchObject({ coursesCreated: 0, quizzesGenerated: 0 });
    expect(result[0]).not.toHaveProperty('stats');
  });

  test('limits after ranking and reflects deletions without changing user documents', () => {
    const users = [{ _id: 'a', cwlId: 'alice' }, { _id: 'b', cwlId: 'bob' }];
    const counts = { folders: [], quizzes: [], questions: [{ _id: 'a', count: 2 }] };
    expect(buildUserContentStats(users, counts, 1)[0].questionsCreated).toBe(2);
    counts.questions = [];
    expect(buildUserContentStats(users, counts)[0].questionsCreated).toBe(0);
    expect(users[0]).not.toHaveProperty('stats');
  });
});
