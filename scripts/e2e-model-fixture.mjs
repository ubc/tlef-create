import http from 'node:http';

// Imported ONLY by the isolated E2E launcher. No production feature flag or
// public mock endpoint can enable this fixture in the application server.
export async function installModelFixture() {
  const embeddingServer = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body || '{}');
    if (parsed.messages) {
      const prompt = parsed.messages.map(message => message.content).join('\n');
      const payload = /clusters/.test(prompt)
        ? { clusters: [{ title: 'Photosynthesis', role: 'concept', sectionIds: ['M1-S1'], keyConcepts: ['Sunlight', 'Glucose'] }] }
        : { instructionalTopics: [{ title: 'Photosynthesis', sectionIds: ['M1-S1'], keyConcepts: ['Sunlight', 'Glucose'] }], summary: 'Plants convert light energy into chemical energy.' };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ id: 'fixture', model: 'e2e-fixture', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(payload) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
      return;
    }
    const input = parsed.input;
    const values = Array.isArray(input) ? input : [input];
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ object: 'list', data: values.map((_, index) => ({ object: 'embedding', index, embedding: Array.from({ length: 1536 }, (__, i) => i === 0 ? 1 : 0) })), usage: { prompt_tokens: 1, total_tokens: 1 } }));
  });
  await new Promise(resolve => embeddingServer.listen(0, '127.0.0.1', resolve));
  Object.assign(process.env, {
    LLM_PROVIDER: 'openai', OPENAI_MODEL: 'e2e-fixture', OPENAI_API_KEY: 'e2e-not-a-real-key',
    OPENAI_API_ENDPOINT: `http://127.0.0.1:${embeddingServer.address().port}/v1`,
    EMBEDDINGS_PROVIDER: 'openai', EMBEDDINGS_MODEL: 'text-embedding-3-small', EMBEDDINGS_DIMENSIONS: '1536',
    EMBEDDINGS_API_KEY: 'e2e-not-a-real-key', EMBEDDINGS_API_ENDPOINT: `http://127.0.0.1:${embeddingServer.address().port}/v1`
  });
  const { default: llm } = await import('../routes/create/services/llmService.js');
  let sequence = 0;
  llm.streamCompletion = async ({ prompt }, onChunk) => {
    let payload;
    if (prompt.includes('PARAMS JSON SCHEMA')) {
      payload = { title: 'E2E tree survey', params: { graphMode: 'barChart', listOfTypes: [{ text: 'Oak', value: 12 }, { text: 'Pine', value: 8 }] } };
      await new Promise(resolve => setTimeout(resolve, 2000));
    } else if (prompt.includes('"planItems"')) {
      payload = { recommendedTotalQuestions: 1, totalQuestionRationale: 'One focused check.', planItems: [{ type: 'multiple-choice', learningObjectiveIndex: 0, count: 1, difficulty: 'moderate', bloomLevel: 'understand', focusArea: 'Photosynthesis', rationale: 'Check the supplied source.' }] };
    } else if (prompt.includes('"objectives"')) {
      payload = { generationSummary: ['Covers photosynthesis.'], objectives: [{ title: 'Explain photosynthesis', text: 'Explain how plants use sunlight to make glucose.', topic: 'Photosynthesis', sourceOutlineSection: 'Photosynthesis', sourceSectionIds: ['M1-S1'], subpoints: ['Sunlight provides energy for photosynthesis.', 'Plants use carbon dioxide and water to make glucose.'], bloomLevel: 'understand', rationale: 'Supported by the material.' }] };
    } else {
      payload = { questionText: `Which energy source powers photosynthesis? (${++sequence})`, content: { options: [{ text: 'Sunlight', isCorrect: true }, { text: 'Sound', isCorrect: false }, { text: 'Gravity', isCorrect: false }, { text: 'Wind', isCorrect: false }] }, correctAnswer: 'Sunlight', explanation: 'Plants use sunlight to convert carbon dioxide and water into glucose.' };
    }
    const content = JSON.stringify(payload);
    onChunk?.(content, { partial: true, totalLength: content.length, model: 'e2e-fixture' });
    return { content, model: 'e2e-fixture' };
  };
}
