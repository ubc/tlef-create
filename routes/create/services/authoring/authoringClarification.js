export const clarificationInstruction = 'Each clarification must declare selectionMode:"multiple" for combinable topic, subject or content-scope choices, or selectionMode:"single" for mutually exclusive decisions such as a question count or resolving contradictory requirements. Topic choices default to multiple; never make conflicting alternatives multiple. Set allowCustomInput:true so the instructor can select Write my own answer and supply a different answer. Do not add Other or a free-text placeholder to options; the UI supplies the custom input. Use allowCustomInput:false only when a strict decision cannot accept a custom alternative.';

export function normalizeClarification(item) {
  const question = item.question.trim();
  const topic = /\b(?:topics?|subjects?|themes?|scope)\b|主题|专题|知识点|内容范围|覆盖范围/i.test(question)
    && !/\b(?:conflict|resolve|either|choose one|which one|only one|how many|question count|number of questions|difficulty)\b|冲突|二选一|只能选|仅选一个|多少|题数|数量|难度/i.test(question)
    && !item.options.some(option => /\b(?:only|all topics|all of the above|entire course|whole course)\b|仅|只(?:讨论|覆盖|包含|教|选)|全部(?:主题|内容|章节)/i.test(option));
  return { question, options: item.options.map(option => option.trim()),
    ...(item.selectionMode != null ? { selectionMode: item.selectionMode } : topic ? { selectionMode: 'multiple' } : {}),
    ...(item.allowCustomInput != null ? { allowCustomInput: item.allowCustomInput } : {}) };
}
