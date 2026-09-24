export default {
  _id: 'branching-runtime-fixture', name: 'Laboratory safety decisions', containerMode: 'standalone',
  questions: [{ _id: 'branching-question', type: 'branching-scenario', questionText: 'Choose a safe response.', content: {
    introText: 'Before entering the laboratory, decide whether to check the equipment.',
    nodes: [{ index: 0 }, { index: 1, question: 'What should you do before using the equipment?', alternatives: [
      { text: 'Check the equipment first', nextContentId: -1, feedback: 'Safe choice: check the equipment before starting.' },
      { text: 'Skip the safety check', nextContentId: -2, feedback: 'Stop and review: the safety check is required.' }
    ] }]
  } }]
};
