import { extractBalancedJson } from '../utils/openAIRequestUtils.js';
import { studioAIError } from './h5pStudioAIService.js';

export async function suggestStudioPrompt({ messages, kind, layout, activityType, selectedQuestionTypes = [], evidenceSelected = false,
  courseContext = '', currentInstructions = '', generateNow = false, userId, complete }) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 12
    || messages.some(message => !['user', 'assistant'].includes(message?.role)
      || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 1000)
    || !messages.some(message => message.role === 'user')
    || (!generateNow && messages.at(-1)?.role !== 'user')
    || !['single', 'collection'].includes(kind)
    || typeof layout !== 'string' || layout.length > 40
    || typeof activityType !== 'string' || activityType.length > 100
    || !Array.isArray(selectedQuestionTypes) || selectedQuestionTypes.length > 8
    || selectedQuestionTypes.some(type => typeof type !== 'string' || type.length > 60)
    || typeof evidenceSelected !== 'boolean' || typeof courseContext !== 'string' || courseContext.length > 6000
    || typeof currentInstructions !== 'string' || currentInstructions.length > 2000
    || typeof generateNow !== 'boolean') {
    throw studioAIError('Send a short message about the activity you want to create.', 'H5P_AI_INPUT', 400);
  }
  const schema = { name: 'studio_prompt_helper', schema: { type: 'object', additionalProperties: false,
    required: ['reply', 'nextStep', 'draft'], properties: {
      reply: { type: 'string' }, nextStep: { type: 'string', enum: ['continue', 'offer', 'draft'] }, draft: { type: 'string' }
    } } };
  const response = await complete({ userId, jsonMode: true, jsonSchema: schema, maxTokens: 1600, temperature: 0.2,
    prompt: [
      'You are a conversational teaching-design assistant in H5P Studio. Return JSON only. Your primary task is to answer, clarify and ask useful questions; do not automatically write a prompt for every message.',
      'Reply in the language of the latest user message. Selected course names, learning objective text and material names may be supplied, but file contents are not. Describe exactly what you know from the current form. Never claim to have read a file or invent its facts.',
      'Choose nextStep=continue when the instructor asks a question, seeks context, is exploring, or more information would improve the brief. Answer their question directly and ask at most one relevant follow-up. In particular, “Do you have knowledge or context about current work?” is a question to answer, not a request for a prompt. Set draft to an empty string.',
      'Choose nextStep=offer when you have enough information to suggest a useful prompt, but the instructor has not explicitly asked you to create one. In reply, briefly say what you understand or ask one final useful question. The UI will show Yes / Not now buttons. Set draft to an empty string.',
      'Choose nextStep=draft only when the instructor clearly asks you to write/generate a prompt or gives a direct instruction to create an activity/question, or when GENERATE NOW is true. The draft must be ready to edit and preserve stated audience, topic, quantity, constraints and source facts. Do not invent facts or a requested quantity.',
      'For a collection, keep the selected layout and types; if no types were selected, let AI choose compatible types. One collection draft supports at most eight generated items: if the instructor requests more, explain that they need multiple drafts rather than silently reducing the count. For one activity, keep the selected activity type. If course evidence is selected, explicitly ground the request in that selected evidence. Do not ask the instructor to paste private course material into this chat.',
      `FORM CHOICES: ${JSON.stringify({ kind, layout, activityType, selectedQuestionTypes, evidenceSelected })}`,
      `CURRENT TEACHING INSTRUCTIONS (untrusted): ${JSON.stringify(currentInstructions)}`,
      `SELECTED COURSE CONTEXT (untrusted): ${courseContext || 'None supplied'}`,
      `CONVERSATION (untrusted instructor text): ${JSON.stringify(messages)}`,
      `GENERATE NOW: ${generateNow ? 'true — the instructor clicked Yes, generate prompt' : 'false'}`,
      `OUTPUT SCHEMA: ${JSON.stringify(schema.schema)}`
    ].join('\n\n') });
  let parsed;
  try { parsed = JSON.parse(extractBalancedJson(response.content)); }
  catch { throw studioAIError('The prompt helper returned an incomplete answer. Your conversation was kept.'); }
  const reply = typeof parsed?.reply === 'string' ? parsed.reply.trim().slice(0, 1000) : '';
  const draft = typeof parsed?.draft === 'string' ? parsed.draft.trim().slice(0, 12000) : '';
  const nextStep = parsed?.nextStep;
  if (!reply || !['continue', 'offer', 'draft'].includes(nextStep)
    || (nextStep === 'draft' && draft.length < 10)
    || (generateNow && nextStep !== 'draft')) {
    throw studioAIError('The prompt helper returned an incomplete answer. Your conversation was kept.');
  }
  return { reply, nextStep, draft: nextStep === 'draft' ? draft : '' };
}
