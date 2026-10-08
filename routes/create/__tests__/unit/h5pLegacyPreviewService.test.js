import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import branchingQuiz from '../fixtures/branchingRuntimeQuiz.js';
import { describe, expect, test } from '@jest/globals';
import { renderLegacyH5PPreview } from '../../services/h5pLegacyPreviewService.js';
import { getPreviewStylesheet, previewStylesheetUrl } from '../../services/h5pPreviewStylesService.js';

describe('historical shared H5P preview', () => {
  test.each(['column', 'question-set', 'interactive-book', 'mixed-activity'])(
    '%s includes the official theme and fonts through one shared stylesheet', async mode => {
      const html = await renderLegacyH5PPreview({ _id: 'test', name: 'Test' }, [{
        _id: 'one', type: 'multiple-choice', questionText: 'Pick an answer.',
        content: { options: [{ text: 'Yes', isCorrect: true }, { text: 'No', isCorrect: false }] }
      }], mode);
      expect(html.split(previewStylesheetUrl)).toHaveLength(2);
      expect(html).not.toContain('--h5p-theme-alternative-base:');
      expect(html).not.toContain('<iframe');
      expect(html.match(/src="[^"\n]*h5p-core\.js[^"\n]*"/g)).toHaveLength(1);
    }
  );

  test('caches complete upstream styles with font URLs and empty Question Set navigation icons', async () => {
    const first = getPreviewStylesheet();
    expect(getPreviewStylesheet()).toBe(first);
    const css = await first;
    expect(css).toContain("font-family: 'h5p-theme'");
    expect(css).toContain("../fonts/h5p-theme.woff2");
    expect(css).toContain('--h5p-theme-alternative-base:');
    expect(css).toContain('--h5p-theme-spacing-xl:');
    expect(css).toContain(':empty[aria-label="Next question"]::after');
    expect(css).toContain(':empty[aria-label="Previous question"]::after');
    expect(css).not.toContain(':empty[aria-label="Previous question"]::before');
  });

  test('runs branching navigation, both endings and restart with the real shared core', () => {
    const result = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('../fixtures/runH5PLegacyBranching.mjs', import.meta.url))], {
      input: JSON.stringify(branchingQuiz), encoding: 'utf8', timeout: 10000,
      env: { ...process.env, NODE_OPTIONS: '' }
    }));
    expect(result.errors).toEqual([]);
    expect(result.outcomes).toEqual([-1, -2]);
    expect(result.endScreenIds).toEqual(['-1', '-2']);
  });
  test('uses one shared runtime for mixed questions and safely embeds content', async () => {
    const html = await renderLegacyH5PPreview({ _id: 'test', name: 'Test' }, [
      { _id: 'one', type: 'discussion', content: { question: '</script><script>alert(1)</script>' } },
      { _id: 'two', type: 'discussion', content: { question: 'Discuss evaporation.' } }
    ], 'mixed-activity');
    expect(html.match(/src="[^"\n]*h5p-core\.js[^"\n]*"/g)).toHaveLength(1);
    expect(html).not.toContain('<iframe');
    expect(html.match(/H5P.newRunnable\(/g)).toHaveLength(2);
    expect(html).toContain('window.jQuery = window.$ = H5P.jQuery');
    expect(html).not.toContain('</script><script>alert(1)</script>');
    expect(html).toContain('tlef:h5p-preview-height');
  });
});
