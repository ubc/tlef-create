import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const lti = require('ltijs').Provider;

/**
 * Submit a score to Canvas Gradebook via LTI AGS (Assignment and Grade Services)
 *
 * @param {object} token - LTI token from the student's launch session
 * @param {number} score - The student's score (raw)
 * @param {number} maxScore - Maximum possible score
 */
export async function submitScore(token, score, maxScore) {
  if (!token) {
    throw new Error('No LTI token provided for grade passback');
  }

  // Normalize score to 0-1 range (Canvas AGS expects this)
  const scoreGiven = Math.max(0, Math.min(score, maxScore));

  const gradeObj = {
    scoreGiven,
    scoreMaximum: maxScore,
    activityProgress: 'Completed',
    gradingProgress: 'FullyGraded',
    userId: token.user,
    timestamp: new Date().toISOString()
  };

  try {
    // Use ltijs Grade service to publish the score
    const result = await lti.Grade.scorePublish(token, gradeObj);
    console.log(`✅ Grade submitted: ${scoreGiven}/${maxScore} for user ${token.user}`);
    return result;
  } catch (error) {
    console.error('❌ Grade passback failed:', error.message);

    // AGS might not be configured for this assignment
    if (error.message?.includes('LINEITEM')) {
      console.warn('⚠️  No line item found — grade passback not configured for this assignment');
    }

    throw error;
  }
}
