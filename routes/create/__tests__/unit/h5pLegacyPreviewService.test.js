import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import branchingQuiz from '../fixtures/branchingRuntimeQuiz.js';
import { describe, expect, test } from '@jest/globals';
import { renderLegacyH5PPreview } from '../../services/h5pLegacyPreviewService.js';

describe('historical shared H5P preview', () => {
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
