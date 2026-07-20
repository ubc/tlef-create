import { beforeEach, describe, expect, test } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import Folder from '../../models/Folder.js';
import LearningObjective from '../../models/LearningObjective.js';
import Quiz from '../../models/Quiz.js';
import User from '../../models/User.js';
import searchController from '../../controllers/searchController.js';

function createTestApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    req.isAuthenticated = () => true;
    next();
  });
  app.use('/api/search', searchController);
  return app;
}

describe('Search API ownership filtering', () => {
  let user;
  let otherUser;
  let app;

  beforeEach(async () => {
    user = await User.create({ cwlId: 'search-owner', password: 'TestPass123' });
    otherUser = await User.create({ cwlId: 'search-other', password: 'TestPass123' });
    app = createTestApp(user);
  });

  test('does not return another instructor learning objectives', async () => {
    const ownFolder = await Folder.create({ name: 'Own course', instructor: user._id });
    const otherFolder = await Folder.create({ name: 'Other course', instructor: otherUser._id });
    const ownQuiz = await Quiz.create({ name: 'Own quiz', folder: ownFolder._id, createdBy: user._id });
    const otherQuiz = await Quiz.create({ name: 'Other quiz', folder: otherFolder._id, createdBy: otherUser._id });

    const ownObjective = await LearningObjective.create({
      text: 'Analyze searchable vectors',
      quiz: ownQuiz._id,
      order: 0,
      createdBy: user._id
    });
    await LearningObjective.create({
      text: 'Analyze searchable vectors from another course',
      quiz: otherQuiz._id,
      order: 0,
      createdBy: otherUser._id
    });

    const response = await request(app).get('/api/search?q=searchable%20vectors');

    expect(response.status).toBe(200);
    expect(response.body.data.results).toHaveLength(1);
    expect(response.body.data.results[0].id).toBe(ownObjective._id.toString());
    expect(response.body.data.results[0].courseId).toBe(ownFolder._id.toString());
    expect(response.body.data.results[0].quizId).toBe(ownQuiz._id.toString());
  });

  test('ignores an objective whose parent quiz is no longer valid', async () => {
    const folder = await Folder.create({ name: 'Course', instructor: user._id });
    const removedQuiz = await Quiz.create({ name: 'Removed quiz', folder: folder._id, createdBy: user._id });
    await LearningObjective.create({
      text: 'Orphaned searchable objective',
      quiz: removedQuiz._id,
      order: 0,
      createdBy: user._id
    });
    await Quiz.deleteOne({ _id: removedQuiz._id });

    const response = await request(app).get('/api/search?q=orphaned%20searchable');

    expect(response.status).toBe(200);
    expect(response.body.data.results).toEqual([]);
  });
});
