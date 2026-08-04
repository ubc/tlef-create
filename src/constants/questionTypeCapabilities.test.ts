import { describe, expect, it } from 'vitest';
import {
  getDefaultFormatForDeliveryTarget,
  getFormatsForDeliveryTarget,
  H5P_PACKAGE_FORMATS
} from './questionTypeCapabilities';

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
