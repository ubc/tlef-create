import { describe, expect, test } from '@jest/globals';
import {
  buildInstructorMetadata,
  mergeInstructorProtectedMetadata,
  validateInstructorMetadata
} from '../../utils/learningObjectiveMetadata.js';

describe('learning objective instructor metadata', () => {
  test('normalizes Bloom level and removes blank subpoints', () => {
    expect(validateInstructorMetadata({
      bloomLevel: ' Create ',
      subpoints: [' First skill ', '', 'Second skill']
    })).toEqual({
      bloomLevel: 'create',
      subpoints: ['First skill', 'Second skill']
    });
  });

  test('tracks which fields were authored by the instructor', () => {
    expect(buildInstructorMetadata({
      bloomLevel: 'apply',
      subpoints: ['Draw a diagram']
    })).toEqual({
      isAIGenerated: false,
      bloomLevel: 'apply',
      subpoints: ['Draw a diagram'],
      instructorAuthoredFields: ['bloomLevel', 'subpoints']
    });
  });

  test('AI enrichment preserves instructor Bloom level and subpoints', () => {
    expect(mergeInstructorProtectedMetadata({
      bloomLevel: 'apply',
      subpoints: ['Instructor subpoint'],
      instructorAuthoredFields: ['bloomLevel', 'subpoints']
    }, {
      bloomLevel: 'analyze',
      subpoints: ['AI subpoint']
    })).toEqual({
      bloomLevel: 'apply',
      subpoints: ['Instructor subpoint']
    });
  });
});
