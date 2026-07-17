import { describe, expect, test } from '@jest/globals';
import mongoose from 'mongoose';
import HelpInteraction from '../../models/HelpInteraction.js';

describe('HelpInteraction model', () => {
  test('accepts a completed interaction with structured feedback', async () => {
    const interaction = new HelpInteraction({
      user: new mongoose.Types.ObjectId(),
      question: 'How do I generate learning objectives?',
      answer: 'Open the Learning Objectives step.',
      status: 'completed',
      rating: {
        value: 'not-helpful',
        reasons: ['incomplete'],
        comment: 'Add the exact button name.',
        ratedAt: new Date()
      }
    });

    await expect(interaction.validate()).resolves.toBeUndefined();
  });

  test('rejects unsupported rating values and reasons', async () => {
    const interaction = new HelpInteraction({
      user: new mongoose.Types.ObjectId(),
      question: 'Question',
      status: 'completed',
      rating: { value: 'maybe', reasons: ['secret-reason'] }
    });

    await expect(interaction.validate()).rejects.toThrow();
  });
});
