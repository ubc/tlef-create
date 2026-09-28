/** Canvas web embeds have a fixed height unless the tool reports its size.
 * https://developerdocs.instructure.com/services/canvas/external-tools/lti/file.lti_window_post_message
 */
export function addCanvasResizeBridge(html, platformUrl) {
  const origin = JSON.stringify(new URL(platformUrl).origin).replace(/</g, '\\u003c');
  const script = `<script>
(function () {
  var lastHeight = 0;
  var pending = false;
  function measure() {
    pending = false;
    var content = document.querySelector('.h5p-content');
    var height = Math.ceil(Math.max(400, document.body.scrollHeight, content ? content.scrollHeight : 0));
    height = Math.min(height, 30000);
    if (height !== lastHeight) {
      lastHeight = height;
      window.parent.postMessage({subject: 'lti.frameResize', height: height}, ${origin});
    }
  }
  function schedule() {
    if (!pending) { pending = true; window.requestAnimationFrame(measure); }
  }
  window.addEventListener('load', function () {
    schedule();
    new ResizeObserver(schedule).observe(document.body);
    new MutationObserver(schedule).observe(document.body, {childList: true, subtree: true, attributes: true});
  });
  window.addEventListener('resize', schedule);
})();
</script>`;
  return html.replace('</body>', `${script}</body>`);
}
