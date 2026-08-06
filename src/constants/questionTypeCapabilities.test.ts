import { describe, expect, it } from 'vitest';
import {
  getDefaultFormatForDeliveryTarget,
  getFormatsForDeliveryTarget,
  H5P_PACKAGE_FORMATS,
  QUESTION_TYPES,
  QUESTION_TYPES_BY_TARGET
} from './questionTypeCapabilities';
import {
  getH5PTypesForContainer,
  listH5PTypeAdapters
} from '../../routes/create/config/h5pTypeAdapterRegistry.js';

describe('H5P package format presentation', () => {
  it('shows formats in the order requested for Generate Questions', () => {
    expect(H5P_PACKAGE_FORMATS.map(format => format.label)).toEqual([
      'Question Set',
      'Interactive Book',
      'Column',
      'Standalone'
    ]);
    expect(getFormatsForDeliveryTarget('h5p-package')).toBe(H5P_PACKAGE_FORMATS);
  });

  it('uses the approved Question Set description', () => {
    expect(H5P_PACKAGE_FORMATS.find(format => format.value === 'question-set')?.description)
      .toBe('Scored quiz format which combines different types of questions in a sequence with text or video feedback');
  });

  it('does not change the existing default format when display order changes', () => {
    expect(getDefaultFormatForDeliveryTarget('h5p-package')).toBe('column');
    expect(getDefaultFormatForDeliveryTarget('canvas-lti')).toBe('mixed-activity');
  });
});

describe('H5P adapter capability parity', () => {
  it('registers every frontend AI question type in the backend adapter registry', () => {
    expect(listH5PTypeAdapters({ aiEnabled: true }).map(adapter => adapter.type))
      .toEqual(QUESTION_TYPES.map(type => type.value));
  });

  it.each(Object.keys(QUESTION_TYPES_BY_TARGET))(
    'keeps the %s container matrix aligned with backend adapters',
    target => {
      expect(new Set(getH5PTypesForContainer(target)))
        .toEqual(new Set(QUESTION_TYPES_BY_TARGET[target as keyof typeof QUESTION_TYPES_BY_TARGET]));
    }
  );
});
