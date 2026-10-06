import { fail, objectId } from './authoringContracts.js';
import { normalizeClarification } from './authoringClarification.js';

export function canonicalClarificationAnswers(message, payload) {
  if (!message || !objectId(payload?.messageId) || String(message._id) !== payload.messageId
    || message.role !== 'assistant' || !Array.isArray(message.clarification) || !message.clarification.length
    || !Array.isArray(payload.answers) || payload.answers.length !== message.clarification.length) {
    fail('Answer every question on the current clarification card.', 400, 'AUTHORING_CLARIFICATION_INPUT');
  }
  const answered = new Map();
  for (const answer of payload.answers) {
    if (!Number.isInteger(answer?.questionIndex) || answer.questionIndex < 0
      || answer.questionIndex >= message.clarification.length || answered.has(answer.questionIndex)
      || !Array.isArray(answer.selectedOptions) || answer.selectedOptions.length > 4
      || answer.selectedOptions.some(option => typeof option !== 'string')
      || new Set(answer.selectedOptions).size !== answer.selectedOptions.length
      || (answer.customAnswer != null && (typeof answer.customAnswer !== 'string'
        || !answer.customAnswer.trim() || answer.customAnswer.length > 500))) {
      fail('Check the selected clarification answers before confirming.', 400, 'AUTHORING_CLARIFICATION_INPUT');
    }
    const question = normalizeClarification(message.clarification[answer.questionIndex]);
    if (answer.selectedOptions.some(option => !question.options.includes(option))
      || (answer.customAnswer != null && question.allowCustomInput === false)) {
      fail('Choose answers offered by the current clarification card.', 400, 'AUTHORING_CLARIFICATION_INPUT');
    }
    const count = answer.selectedOptions.length + (answer.customAnswer == null ? 0 : 1);
    if (!count || ((question.selectionMode || 'single') === 'single' && count !== 1)) {
      fail('Answer each clarification using its single or multiple selection mode.', 400, 'AUTHORING_CLARIFICATION_INPUT');
    }
    answered.set(answer.questionIndex, { questionIndex: answer.questionIndex,
      selectedOptions: question.options.filter(option => answer.selectedOptions.includes(option)),
      ...(answer.customAnswer == null ? {} : { customAnswer: answer.customAnswer.trim() }) });
  }
  const answers = message.clarification.map((_, index) => answered.get(index));
  const text = ['Apply these answers to the current task, keeping the other confirmed requirements:',
    ...answers.map(answer => `${message.clarification[answer.questionIndex].question} ${[
      ...answer.selectedOptions, ...(answer.customAnswer == null ? [] : [answer.customAnswer])].join('; ')}`)].join('\n');
  if (text.length > 4000) fail('Shorten your answers to fit the message limit.', 400, 'AUTHORING_CLARIFICATION_INPUT');
  return { text, clarificationAnswers: { messageId: payload.messageId, answers } };
}
