import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, test } from '@jest/globals';

function loadRuntime() {
  const context = { window: { location: { origin: 'http://localhost' } }, console };
  vm.runInNewContext(fs.readFileSync(new URL('../../h5p-core/h5p-core.js', import.meta.url), 'utf8'), context);
  return context.H5P;
}

describe('shared preview xAPI forwarding', () => {
  test('Book receives the child identity exactly once through nested containers', () => {
    const H5P = loadRuntime();
    const book = new H5P.EventDispatcher();
    const column = new H5P.EventDispatcher();
    const question = new H5P.EventDispatcher();
    column.parent = book;
    question.parent = column;
    question.subContentId = 'question-one';
    question.getAnswerGiven = () => true;
    const completed = [];
    H5P.externalDispatcher.on('xAPI', function (event) {
      if (event.getVerb() === 'answered' && this.getAnswerGiven()) completed.push(this.subContentId);
    });
    question.triggerXAPIScored(1, 1, 'answered', true, true);
    expect(completed).toEqual(['question-one']);
  });

  test('retains local parent context and explicit listener context', () => {
    const H5P = loadRuntime();
    const parent = new H5P.EventDispatcher();
    const child = new H5P.EventDispatcher();
    const explicit = {};
    child.parent = parent;
    const contexts = [];
    parent.on('xAPI', function () { contexts.push(this); });
    H5P.externalDispatcher.on('xAPI', function () { contexts.push(this); }, explicit);
    child.triggerXAPI('interacted');
    expect(contexts).toEqual([parent, explicit]);
  });
});
