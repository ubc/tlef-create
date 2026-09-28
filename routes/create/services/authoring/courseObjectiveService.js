import llmService from '../llmService.js';
import coursePromptService from '../coursePromptService.js';
import User from '../../models/User.js';

// Use the canonical inventory/coverage-repair pipeline and the same course
// constraints as the Learning Objectives controller, not a chat-only LO prompt.
export async function generateCourseObjectives({ materials, quiz, owner, instructions, onProgress }) {
  const user = await User.findById(owner).select('preferences');
  const [course, coverage] = await Promise.all([
    coursePromptService.buildCoursePromptInstructions({ folderId: quiz.folder, userId: owner,
      promptType: 'learning-objectives', userInstructions: instructions }),
    coursePromptService.buildCoursePromptInstructions({ folderId: quiz.folder, userId: owner, promptType: 'coverage-map' })
  ]);
  const result = await llmService.generateLearningObjectives(materials, `Learning Object: ${quiz.name}`, 6,
    user?.preferences || null, coursePromptService.mergePromptParts(course.prompt, coverage.prompt),
    instructions, owner, onProgress);
  const objectives = Array.isArray(result) ? result : result.objectives;
  if (!Array.isArray(objectives) || !objectives.length || objectives.length > 8) {
    throw Object.assign(new Error('The learning objectives need review. Retry with a narrower teaching scope (up to eight objectives).'), { status: 422, code: 'STUDIO_ASSISTANT_OBJECTIVES' });
  }
  return objectives.map((value, index) => {
    const objective = typeof value === 'string' ? { text: value } : value;
    const text = objective?.text || objective?.objective;
    if (typeof text !== 'string' || !text.trim()) throw Object.assign(new Error('A generated learning objective was empty. Retry with a clearer teaching scope.'), { status: 422 });
    const sourceReferences = objective.sourceReferences || objective.generationMetadata?.sourceReferences || [];
    return { id: `objective-${index + 1}`, text: text.trim(), sourceReferences,
      metadata: { ...objective, sourceReferences, promptSource: course.source, promptVersion: course.version,
        llmModel: result.llmModel, coverageDiagnostics: result.coverageDiagnostics,
        inventoryDiagnostics: result.inventoryDiagnostics } };
  });
}
