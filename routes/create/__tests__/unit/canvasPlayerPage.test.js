import {expect, test, jest} from '@jest/globals';
import vm from 'node:vm';
import {addCanvasResizeBridge} from '../../services/canvasPlayerPage.js';

test('reports changing content height to only the Canvas origin without a resize loop', () => {
  const html = addCanvasResizeBridge('<html><body>Activity</body></html>', 'http://localhost/courses/2');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const listeners = {};
  const queue = [];
  let observerCallback;
  const body = {scrollHeight: 850};
  const postMessage = jest.fn();
  vm.runInNewContext(script, {
    document: {body, querySelector: () => ({scrollHeight: body.scrollHeight})},
    window: {parent:{postMessage}, addEventListener:(event,callback)=>{listeners[event]=callback;}, requestAnimationFrame:callback=>queue.push(callback)},
    ResizeObserver: class {constructor(callback){observerCallback=callback;} observe(){}},
    MutationObserver: class {observe(){}}
  });
  listeners.load(); queue.shift()();
  expect(postMessage).toHaveBeenLastCalledWith({subject:'lti.frameResize',height:850},'http://localhost');
  observerCallback(); queue.shift()();
  expect(postMessage).toHaveBeenCalledTimes(1);
  body.scrollHeight=1100; observerCallback(); queue.shift()();
  expect(postMessage).toHaveBeenLastCalledWith({subject:'lti.frameResize',height:1100},'http://localhost');
});
