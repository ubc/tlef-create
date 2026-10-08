import fs from 'node:fs/promises';
import { H5P_CORE_STYLES, H5P_RUNTIME_REVISION } from '../config/h5pRuntime.js';

// Keep the bundle under /core/styles so upstream ../fonts URLs still resolve.
export const previewStylesRevision = `${H5P_RUNTIME_REVISION}-preview-theme-2`;
export const previewStylesheetUrl = `/api/create/h5p-preview/core/styles/preview.css?createRevision=${previewStylesRevision}`;

let stylesheetPromise;

// QuestionSet 1.20 supplies label-less navigation to the newer Question theme
// button API. Restore icons only for those empty buttons; keep native labels.
// Both icons use ::after because the theme reserves ::before for hidden tips.
export const questionSetNavigationStyles = `
.questionset .h5p-question-buttons .h5p-theme-button:empty[aria-label="Next question"]::after {
  content: "\\e901";
  font-family: 'h5p-theme';
}
.questionset .h5p-question-buttons .h5p-theme-button:empty[aria-label="Previous question"]::after {
  content: "\\e900";
  font-family: 'h5p-theme';
}
`;

/** One cached request for the pinned core styles, without loading editor code. */
export function getPreviewStylesheet() {
  if (!stylesheetPromise) {
    stylesheetPromise = Promise.all(H5P_CORE_STYLES.map(asset =>
      fs.readFile(new URL(`../h5p-core/${asset}`, import.meta.url), 'utf8')
    )).then(styles => styles.join('\n') + questionSetNavigationStyles).catch(error => {
      stylesheetPromise = undefined;
      throw error;
    });
  }
  return stylesheetPromise;
}
