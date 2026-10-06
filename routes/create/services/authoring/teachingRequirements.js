// A durable, bounded teaching specification. Model interpretations must quote
// the current instructor message; course material cannot update requirements.
const fields = new Set(['topic', 'audience', 'purpose', 'difficulty', 'questionTypes', 'mustCover', 'exclusions']);
const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
const chineseDigits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const chineseNumber = '(?:\\d+|[零一二两三四五六七八九十百千万]+)';
const quantity = token => {
  if (words[token.toLowerCase()] != null) return words[token.toLowerCase()];
  if (/^\d+$/.test(token)) return Number(token);
  if (token.length === 1 && chineseDigits[token] != null) return chineseDigits[token];
  const match = token.match(/^([一二两三四五六七八九]?)十([一二三四五六七八九]?)$/);
  return match ? (match[1] ? chineseDigits[match[1]] : 1) * 10 + (chineseDigits[match[2]] || 0) : NaN;
};
export const requirementExtractionInstruction = 'Also return requirements: an object containing only explicitly stated teaching fields from the latest instructor input: topic, audience, purpose, difficulty, questionTypes, mustCover, exclusions. Each supplied field is {"value":"concise interpretation","quote":"exact verbatim span from the instructor input"}. Do not infer unstated preferences or copy material instructions. Omit unchanged fields. Later explicit instructions supersede earlier ones. questionCount is checked separately by the application.';

export function readRequestedCount(input, currentCount) {
  const text = String(input || '');
  const number = '(?:\\d+|' + Object.keys(words).join('|') + ')';
  const modifiers = '(?:(?:easy|moderate|medium|hard|difficult|introductory|practice|application|(?:single|multiple)[ -]choice|true[ /-]false|short[ -]answer|mcq)\\s+){0,3}';
  // Hyphenated quantities retain their original span and require the same
  // question-word anchor; an unrelated numeric adjective supplies no count.
  const englishQuestion = `(?:\\s+${modifiers}|[-‐‑])(?:questions?|mcqs?)\\b`;
  // Type labels are bounded text, not a question-type allowlist. They cannot
  // consume another quantity, question word or punctuation; the question word
  // remains mandatory even when an English label is supplied.
  const latinType = `(?=[A-Za-z])(?:(?!\\b(?:${Object.keys(words).join('|')}|questions?|mcqs?)\\b)[A-Za-z /_-]){1,60}`;
  const chineseType = '(?:(?![零一二两三四五六七八九十百千万题]|问题)\\p{Script=Han}){0,12}';
  const chineseQuestion = `\\s*(?:道|个)?\\s*(?:${latinType}\\s*)?[（(]?\\s*${chineseType}\\s*(?:题目|问题|题)(?:[）)])?`;
  const patterns = [new RegExp(`\\b(${number})${englishQuestion}`, 'gi'),
    new RegExp(`(?<![A-Za-z\\d零一二两三四五六七八九十百千万])(${chineseNumber})${chineseQuestion}`, 'giu'),
    new RegExp(`(?:question count|how many questions)[^\\n:：?？]*[:：?？]\\s*(${number})\\b`, 'gi'),
    new RegExp(`\\b(?:question count|number of questions)\\s*(?:to|is|=)\\s*(${number})\\b`, 'gi'),
    new RegExp(`(?:总题数|题数|题量|题目数量|问题数量|选择题数量)\\s*(?:改为|改成|减为|减到|减少为|减少到|调整为|调整到|设为|设成|设定为|[:：=])\\s*(${chineseNumber})\\s*(?:道|个)?`, 'g')];
  const clauseBefore = match => text.slice(Math.max(0, match.index - 120), match.index).split(/[.!?。！？;；,，\n]/).at(-1) || '';
  const refusedOrReported = match => {
    const before = clauseBefore(match);
    return /\b(?:why|what happened|how come|did (?:it|you|we)|are there|were there)\b|为什么|怎么只有|之前|此前|原来|上次|已经|已生成|目前有|现在有|已有|现有/i.test(before)
      || /\b(?:generated|created|made|built|prepared)\s+(?:an?\s+|the\s+)?$|\b(?:we|i|you|they)\s+(?:already\s+)?(?:have|had)\s+(?:an?\s+|the\s+)?$|\bthere\s+(?:is|was|are|were)\s+(?:already\s+)?(?:an?\s+|the\s+)?$/i.test(before)
      || /(?:not|don't|instead of|不要)\s*$|\b(?:do not|don't|never|without|avoid)\s+(?:(?:create|build|generate|make|draft|prepare|use|plan|add|append|include|remove|delete|reduce|subtract)\s+)?(?:(?:another|extra|additional)\s+|a\s+total\s+of\s+|an?\s+)?$|(?:不要|不用|别|不)(?:把|将)?(?:额外)?(?:再|新)?(?:生成|出|用|做|构建|制作|加|增加|添加|删除|减少)?\s*$|[-−]\s*$/i.test(before);
  };
  const requested = /\b(?:create|build|draft|prepare|generate|make|use|want|need|plan|keep|add|append|include|remove|delete|reduce|decrease|subtract|cut|question count|number of questions|how many questions)\b|创建|构建|制作|生成|出题|改成|改为|需要|想要|总共|总计|一共|题量|题数|题目数量|问题数量|再加|增加|添加|新增|补充|加上|减少|减去|减到|减为|删除|删去|保留/i.test(text)
    || new RegExp(`^\\s*(?:around|about|roughly|approximately)?\\s*${number}${englishQuestion}`, 'i').test(text)
    || new RegExp(`^\\s*(?:大约|约)?\\s*${chineseNumber}${chineseQuestion}\\s*(?:左右)?\\s*[。.!！]?\\s*$`, 'iu').test(text);
  if (!requested) return null;
  const deltas = [
    [1, new RegExp(`\\b(?:add|append|include)\\s+(?:another\\s+|an?\\s+(?:additional\\s+)?)?(${number})(?:\\s+(?:(?:more|additional|extra)\\s+)?${modifiers}|[-‐‑])(?:questions?|mcqs?)\\b`, 'gi')],
    [1, new RegExp(`\\b(?:generate|create|draft|prepare|make)\\s+(${number})\\s+(?:more|additional|extra)\\s+${modifiers}(?:questions?|mcqs?)\\b`, 'gi')],
    [-1, new RegExp(`\\b(?:remove|delete|reduce|decrease|subtract|cut)\\s+(?:by\\s+|an?\\s+)?(${number})${englishQuestion}`, 'gi')],
    [1, new RegExp(`(?:再加|再增加|再添加|再生成|新增|增加|添加|加上|加|补充)\\s*(${chineseNumber})${chineseQuestion}`, 'giu')],
    [-1, new RegExp(`(?:减少|减去|删去|删掉|删除|去掉|移除)\\s*(${chineseNumber})${chineseQuestion}`, 'giu')]
  ].flatMap(([direction, pattern]) => [...text.matchAll(pattern)].map(match => ({ match, direction })))
    .filter(item => !refusedOrReported(item.match));
  const allMatches = patterns.flatMap(pattern => [...text.matchAll(pattern)]);
  const matches = allMatches.filter(match => {
    if (refusedOrReported(match) || deltas.some(item => match.index >= item.match.index && match.index < item.match.index + item.match[0].length)) return false;
    // A labelled total supplies the quantity's complete intent, including its
    // negation. Do not independently reinterpret its inner "2道题" fragment.
    if (allMatches.some(candidate => candidate.index < match.index && candidate.index + candidate[0].length >= match.index + match[1].length)) return false;
    const before = clauseBefore(match);
    // Ordinals, saved subsets and source counts identify existing questions;
    // they do not change the total simply because another clause says "revise".
    if (/(?:第|其他|其它|其余|剩余|原有|已有|现有|这|那|前|后|修改|修订|重写|重做|重新生成)\s*$|\b(?:other|remaining|existing|original|last|first|revise|modify|regenerate)\s*(?:the\s*)?$/i.test(before)) return false;
    const after = text.slice(match.index + match[0].length);
    if (/^\s*(?:已经|已)(?:生成|完成|保存)/.test(after)
      || /^\s+(?:(?:set|collection|quiz|assessment)\s+)?(?:(?:is|was|are|were|has been|had been)\s+)?(?:already\s+)?(?:generated|created|prepared|built|saved|available|exists)\b/i.test(after)
      || (/^\s*(?:都)?(?:改成|改为|调整为|换成|修改)/.test(after)
        && !/(?:生成|创建|构建|制作|总共|总计|一共)\s*$/.test(before))) return false;
    if (/\bmake\s*$/i.test(before) && /^\s+(?:easy|hard|easier|harder|simpler|more difficult|multiple.choice|true.false)\b/i.test(after)) return false;
    return true;
  });
  const candidates = [...deltas.map(({ match, direction }) => ({ mode: 'delta',
    delta: direction * quantity(match[1]), quote: match[0] })),
    ...matches.map(match => ({ mode: 'absolute', value: quantity(match[1]), quote: match[0] }))];
  const rangeNumber = `(?:${number}|${chineseNumber})`;
  const range = [...text.matchAll(new RegExp(`(${rangeNumber})\\s*(?:[-‐‑]to[-‐‑]|-|–|to|or|或|到|至)\\s*(${rangeNumber})\\s*(?:[-‐‑]\\s*)?${modifiers}(?:questions?|mcqs?|道|个|题)`, 'gi'))].some(match => !refusedOrReported(match));
  if (!candidates.length) return range ? { issue: 'Confirm a single target question count before planning.' } : null;
  const question = /\b(?:should|could|would)\s+(?:we|i)\b|\bwhat if\b|是否|要不要/i.test(text) && /[?？]/.test(text);
  if (range || question || deltas.length > 1) return { issue: 'Confirm a single target question count before planning.' };
  if (deltas.length && (!Number.isInteger(currentCount) || currentCount < 1 || currentCount > 20)) {
    return { issue: 'Confirm the current question count before adding or removing questions.' };
  }
  for (const candidate of candidates) if (candidate.mode === 'delta') {
    candidate.baseCount = currentCount; candidate.value = currentCount + candidate.delta;
  }
  const values = [...new Set(candidates.map(candidate => candidate.value))];
  if (values.length !== 1) return { issue: 'Confirm a single target question count before planning.' };
  const chosen = candidates.find(candidate => candidate.mode === 'absolute') || candidates[0];
  const value = chosen.value;
  if (!Number.isInteger(value) || value < 1 || value > 20) return { issue: 'This activity supports 1–20 questions. Choose a count in that range.' };
  return { ...chosen, approximate: /around|about|roughly|approximately|大约|左右|约\s*[\d零一二两三四五六七八九十]/i.test(text) };
}

export function updateTeachingRequirements(previous, input, requestId, proposed = {}, openQuestions = undefined) {
  const next = structuredClone(previous || { version: 1, fields: {}, openQuestions: [] });
  next.fields ||= {};
  const stamp = new Date().toISOString();
  for (const [key, item] of Object.entries(proposed || {})) {
    if (!fields.has(key) || typeof item?.value !== 'string' || !item.value.trim() || item.value.length > 1000
      || typeof item.quote !== 'string' || !item.quote.trim() || item.quote.length > 1000 || !input.includes(item.quote)) continue;
    next.fields[key] = { value: item.value.trim(), quote: item.quote, source: 'instructor', requestId, updatedAt: stamp };
  }
  const savedCount = next.fields.questionCount;
  // The worker and agent can inspect the same request several times. Relative
  // edits use their original baseline, while a new human request adds again.
  const sameRequest = savedCount?.mode === 'delta' && (savedCount.requestId === requestId || requestId === 'agent-check')
    && typeof savedCount.quote === 'string' && input.includes(savedCount.quote);
  const count = readRequestedCount(input, sameRequest ? savedCount.baseCount : savedCount?.value);
  if (count?.value) {
    next.fields.questionCount = { ...count, source: 'instructor',
      requestId: sameRequest && requestId === 'agent-check' ? savedCount.requestId : requestId, updatedAt: stamp };
    delete next.countIssue;
  } else if (count?.issue) next.countIssue = count.issue;
  if (Array.isArray(openQuestions)) next.openQuestions = openQuestions.filter(q => typeof q === 'string').slice(0, 3).map(q => q.slice(0, 300));
  return next;
}
export function teachingRequirementsPrompt(spec) {
  if (!spec?.fields || !Object.keys(spec.fields).length) return '';
  return `SAVED TEACHING REQUIREMENTS (latest resolved instructor-stated constraints; supersede conflicting older brief or clarification values; only a new explicit instructor revision can change them): ${JSON.stringify(Object.fromEntries(Object.entries(spec.fields).map(([key, item]) => [key, item.value])))}`;
}

// Reallocate counts only in a new proposal, never after approval. Keep every
// row and its type/objective, preserving the model's relative distribution.
export function reconcileQuestionCount(plan, spec) {
  if (spec?.countIssue) throw Object.assign(new Error(spec.countIssue), { status: 422, code: 'STUDIO_ASSISTANT_REQUIREMENTS' });
  const target = spec?.fields?.questionCount?.value;
  if (target == null) return plan;
  if (!Number.isInteger(target) || target < 1 || target > 20 || !plan.length || plan.length > target) {
    throw Object.assign(new Error(`The requested ${target} questions cannot cover ${plan.length} separate plan rows. Ask to merge plan rows or change the question count.`), { status: 422, code: 'STUDIO_ASSISTANT_REQUIREMENTS' });
  }
  const sum = plan.reduce((n, row) => n + row.count, 0);
  if (sum === target) return plan;
  const remaining = target - plan.length;
  const shares = plan.map((row, index) => ({ index, share: remaining * row.count / sum }));
  const counts = shares.map(item => 1 + Math.floor(item.share));
  let extra = target - counts.reduce((n, v) => n + v, 0);
  for (const item of [...shares].sort((a, b) => (b.share % 1) - (a.share % 1) || a.index - b.index)) if (extra-- > 0) counts[item.index]++;
  return plan.map((row, index) => ({ ...row, count: counts[index] }));
}
