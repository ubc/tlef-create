import { describe, expect, test } from '@jest/globals';
import { classifyAuditAction } from '../../middleware/audit.js';
import { sanitizeAuditMetadata } from '../../services/auditService.js';

describe('privacy-safe audit classification', () => {
  test('classifies important CREATE mutations', () => {
    expect(classifyAuditAction('POST', '/materials/upload')).toEqual({ action: 'material.upload', resourceType: 'material' });
    expect(classifyAuditAction('POST', '/objectives/generate')).toEqual({ action: 'objective.generate', resourceType: 'objective' });
    expect(classifyAuditAction('POST', '/objectives/classify')).toEqual({ action: 'objective.classify', resourceType: 'objective' });
    expect(classifyAuditAction('PUT', '/questions/507f1f77bcf86cd799439011/review')).toEqual({ action: 'question.review', resourceType: 'question' });
    expect(classifyAuditAction('POST', '/course-prompts/folder/507f1f77bcf86cd799439011/reset')).toEqual({ action: 'prompt.reset', resourceType: 'prompt' });
    expect(classifyAuditAction('POST', '/admin/reports')).toEqual({ action: 'report.create', resourceType: 'report' });
    expect(classifyAuditAction('POST', '/help/chat')).toEqual({ action: 'help.ask', resourceType: 'help' });
    expect(classifyAuditAction('PATCH', '/help/interactions/507f1f77bcf86cd799439011/rating')).toEqual({ action: 'help.rate', resourceType: 'help' });
  });

  test('does not classify read-only requests', () => {
    expect(classifyAuditAction('GET', '/materials/507f1f77bcf86cd799439011')).toBeNull();
    expect(classifyAuditAction('GET', '/admin/activity')).toBeNull();
  });

  test('drops content and credentials from metadata', () => {
    expect(sanitizeAuditMetadata({
      model: 'gpt-4o-mini',
      count: 3,
      prompt: 'private prompt',
      content: 'raw course content',
      apiKey: 'secret'
    })).toEqual({ model: 'gpt-4o-mini', count: 3 });
  });
});
