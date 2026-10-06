import mongoose from 'mongoose';

// A bounded instructor-visible record of checks; never a source/prompt log.
export const questionReviewSummarySchema = new mongoose.Schema({
  kind: { type: String, enum: ['feedback', 'semantic'], required: true },
  policyVersion: { type: String, maxlength: 100, required: true },
  checks: {
    contentIsValid: Boolean, answerIsCorrect: Boolean, rubricIsAppropriate: Boolean,
    feedbackIsConsistent: Boolean, followsInstructorRequest: Boolean, evidenceIsSufficient: Boolean
  },
  arithmeticChecks: { type: Number, min: 0, max: 1000, default: 0 },
  goalCoveragePolicyVersion: { type: String, maxlength: 100 },
  goalCoverage: { type: [{ _id: false, id: { type: String, required: true, maxlength: 100 }, isCovered: { type: Boolean, required: true } }],
    default: undefined, validate: { validator: values => !values || values.length <= 8, message: 'At most eight learning-goal checks can be saved.' } },
  mediaInspection: { type: String, enum: ['not-performed'], required: true }
}, { _id: false });
