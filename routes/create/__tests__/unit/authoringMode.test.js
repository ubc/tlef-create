import { expect, test } from '@jest/globals';
import { requestedAuthoringMode, authoringModeForRequest, authorizesAgentBuild } from '../../services/authoring/authoringMode.js';

test.each([
  "Don't create15;create3",
  "Don't create 15 questions; create 3 questions.",
  "Don't create 15 questions, but create 3 questions.",
  '不要生成判断题，生成3道单选题',
  '只讨论教学方法；现在生成3道题。',
  'Create a Chart from these values.', '请生成一个时间线。',
  '请创建一个 H5P Chart 柱状图，不生成题目。先给我可确认的活动计划。',
  '请创建一个 H5P Timeline，不生成题目。',
  '请创建一个任意新安装的 H5P 类型，不生成题目。',
  '先给教学计划，不生成题目。',
  '请先给我可确认的活动计划，不生成题目。',
  'Create a native activity, do not generate questions.',
  '请创建一个 H5P Chart 并不生成题目。',
  '旧计划已失效，请提出一份新的原生活动计划供我确认：H5P Chart。只用这三项给定数据，不添加结论，不生成题目。此前25秒的修改先不要执行。',
  '请提出一份新的原生活动计划供我确认；旧计划先不要执行。',
  '请创建一个任意新安装的 H5P 类型；某项数据修改暂缓。',
  '请创建新的原生活动计划；先不要执行此前25秒的修改。',
  '此前25秒的修改先不要执行；请创建新的原生活动计划。'
])('a later explicit build correction authorizes the current request: %s', text => {
  expect(requestedAuthoringMode(text)).toBe('build');
  expect(authoringModeForRequest('explore', text)).toBe('build');
  expect(authorizesAgentBuild({ mode: 'explore' }, text)).toBe(true);
});

test.each([
  "Don't create15",
  '不要生成判断题',
  '只讨论如何生成3道题。',
  '只讨论，不生成题目。',
  '先不要生成题目，先讨论教学方法。',
  '生成3道题；先不要生成。',
  'Create 3 questions, but just discuss the teaching approach first.',
  'Create 3 questions; do not generate yet.',
  '请不要创建活动。',
  '不要构建活动，只讨论。',
  '请创建一个 H5P Chart，只讨论教学方法。',
  '请创建一个 H5P Chart，不要构建活动。',
  '不生成题目。',
  'Create questions, do not generate questions.',
  '生成3道题，不生成题目。',
  '请创建3道题并不生成题目。',
  '请提出新的原生活动计划；先不要构建活动。',
  '旧计划已失效；请提出新活动计划；暂不生成。',
  '请创建新活动；某项数据修改暂缓；只讨论。',
  '旧计划先不要执行；创建3道题；不生成题目。'
])('discussion or a later deferral withdraws saved build intent: %s', text => {
  expect(requestedAuthoringMode(text)).toBe('explore');
  expect(authoringModeForRequest('build', text)).toBe('explore');
  expect(authorizesAgentBuild({ mode: 'build' }, text)).toBe(false);
});

test.each([
  "Don't create15;create3",
  '不要生成判断题，生成3道单选题',
  'Create 3 questions.',
  '请提出新活动计划；此前25秒的修改先不要执行。'
])('an explicit exploration stage still takes priority over current build text: %s', text => {
  expect(authoringModeForRequest('build', text, 'explore')).toBe('explore');
  expect(authorizesAgentBuild({ mode: 'build' }, text, 'explore')).toBe(false);
});

test.each(['How can I create 5 questions?', '我想聊聊如何生成5道题。', '如何创建一个 H5P 类型？', '将总题数改为3道题。',
  '此前25秒的修改先不要执行。', '某项数据修改暂缓。'])('neutral clarifications and questions preserve the saved stage: %s', text => {
  expect(requestedAuthoringMode(text)).toBeNull();
  expect(authoringModeForRequest('build', text)).toBe('build');
  expect(authoringModeForRequest('explore', text)).toBe('explore');
});
