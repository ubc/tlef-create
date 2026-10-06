import { afterEach, expect, jest, test } from '@jest/globals';
import jobs from '../../services/processingJobService.js';

afterEach(() => { jest.restoreAllMocks(); jobs.jobQueue = []; jobs.currentJobs = 0; jobs.isProcessing = false; jest.useRealTimers(); });
test('continues draining a batch after the three-worker concurrency limit is reached', async () => {
  const finished = [];
  jest.spyOn(jobs, 'processJob').mockImplementation(async job => {
    jobs.currentJobs++;
    await Promise.resolve();
    finished.push(job.id); jobs.currentJobs--;
    await jobs.startProcessing();
  });
  jobs.jobQueue = Array.from({ length: 8 }, (_, index) => ({ id: index }));
  await jobs.startProcessing();
  for (let index = 0; index < 12; index++) await Promise.resolve();
  expect(finished).toHaveLength(8);
  expect(jobs.jobQueue).toHaveLength(0);
  expect(jobs.isProcessing).toBe(false);
});
test('waits for the retry deadline instead of immediately repeating a failed paid operation', async () => {
  jest.useFakeTimers();
  jest.spyOn(jobs, 'processJob').mockResolvedValue();
  jobs.jobQueue = [{ id: 'retry', retryAt: new Date(Date.now() + 5000) }];
  await jobs.startProcessing();
  expect(jobs.processJob).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(5000);
  expect(jobs.processJob).toHaveBeenCalledTimes(1);
});
