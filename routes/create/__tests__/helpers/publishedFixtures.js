import Quiz from '../../models/Quiz.js';
import LearningObjective from '../../models/LearningObjective.js';
import Question from '../../models/Question.js';

// Production publishes generated records by linking their IDs on the quiz.
async function createPublished(Model, field, input) {
  const result = await Model.create(input);
  for (const record of Array.isArray(result) ? result : [result]) {
    await Quiz.updateOne({ _id: record.quiz }, { $addToSet: { [field]: record._id } });
  }
  return result;
}

export const createPublishedObjective = input => createPublished(LearningObjective, 'learningObjectives', input);
export const createPublishedQuestion = input => createPublished(Question, 'questions', input);
