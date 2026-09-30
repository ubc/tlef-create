import { afterAll, afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import User from '../../models/User.js';
import Folder from '../../models/Folder.js';
import Quiz from '../../models/Quiz.js';
import BugReport from '../../models/BugReport.js';
import HelpInteraction from '../../models/HelpInteraction.js';
import AuditEvent from '../../models/AuditEvent.js';

const previousAllowlist = process.env.ADMIN_CWLS;
process.env.ADMIN_CWLS = 'admin-login';
const { default: adminRouter } = await import('../../controllers/adminController.js');
afterAll(() => {
  if (previousAllowlist === undefined) delete process.env.ADMIN_CWLS;
  else process.env.ADMIN_CWLS = previousAllowlist;
});
afterEach(() => jest.restoreAllMocks());
beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));

function appFor(user) {
  const app = express();
  app.use((req, res, next) => {
    req.isAuthenticated = () => Boolean(user);
    req.user = user;
    next();
  });
  app.use('/admin', adminRouter);
  return app;
}
const administrator = { _id: 'admin-id', cwlId: 'admin-puid', cwlUsername: 'admin-login', displayName: 'Administrator' };

describe('administrator identity responses', () => {
  test('the actual stats route selects identity fields and returns them with saved-content counts', async () => {
    const target = { _id: 'faculty-id', cwlId: 'faculty-puid', displayName: 'Professor Ada', email: 'ada@example.test', cwlUsername: 'ada-cwl' };
    for (const model of [User, Folder, Quiz, HelpInteraction, BugReport]) {
      jest.spyOn(model, 'countDocuments').mockResolvedValue(1);
    }
    jest.spyOn(AuditEvent, 'distinct').mockResolvedValue([]);
    jest.spyOn(HelpInteraction, 'aggregate').mockResolvedValue([]);
    jest.spyOn(Folder, 'aggregate').mockResolvedValue([{ _id: target._id, count: 2 }]);
    jest.spyOn(Quiz, 'aggregate').mockResolvedValueOnce([{ count: 5 }])
      .mockResolvedValueOnce([{ _id: target._id, count: 3 }])
      .mockResolvedValueOnce([{ _id: target._id, count: 5 }]);
    const find = jest.spyOn(User, 'find').mockReturnValue({ lean: () => Promise.resolve([target]) });
    const response = await request(appFor(administrator)).get('/admin/stats');
    expect(response.status).toBe(200);
    const selection = find.mock.calls[0][1].split(' ');
    expect(selection).toEqual(expect.arrayContaining(['cwlId', 'cwlUsername', 'displayName', 'email']));
    expect(selection).not.toContain('password');
    expect(response.body.data.users[0]).toMatchObject({ ...target, coursesCreated: 2, quizzesGenerated: 3, questionsCreated: 5 });
  });

  test.each(['/stats', '/users', '/reports', '/activity', '/guide-insights'])('keeps identity data private at %s even when a human name matches an admin username', async path => {
    const find = jest.spyOn(User, 'find');
    const unauthenticated = await request(appFor(null)).get(`/admin${path}`);
    expect(unauthenticated.status).toBe(401);
    const nonAdmin = await request(appFor({ _id: 'other-id', cwlId: 'other-puid', displayName: 'admin-login' })).get(`/admin${path}`);
    expect(nonAdmin.status).toBe(403);
    expect(find).not.toHaveBeenCalled();
  });

  test('reporter population requests names/email as well as Login ID', async () => {
    const query = { populate: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue([]) };
    jest.spyOn(BugReport, 'find').mockReturnValue(query);
    expect((await request(appFor(administrator)).get('/admin/reports')).status).toBe(200);
    expect(query.populate).toHaveBeenCalledWith('reporter', 'cwlId cwlUsername displayName email');
  });
});
