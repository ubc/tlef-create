// These lists match the official core release pinned in h5p-runtime-manifest.json.
// Updating the advertised API requires replacing the real browser assets too.
export const H5P_CORE_API = Object.freeze({ major: 1, minor: 28 });
export const H5P_CORE_VERSION = '1.28.0';
export const H5P_RUNTIME_REVISION = '20260921-core128-opaque-resize';

export const H5P_CORE_SCRIPTS = [
  'js/jquery.js', 'js/h5p-jquery-bridge.js', 'js/h5p.js',
  'js/h5p-event-dispatcher.js', 'js/h5p-x-api-event.js', 'js/h5p-x-api.js',
  'js/h5p-content-type.js', 'js/h5p-confirmation-dialog.js',
  'js/h5p-action-bar.js', 'js/request-queue.js', 'js/h5p-tooltip.js'
];

export const H5P_CORE_STYLES = [
  'styles/h5p-fonts.css', 'styles/h5p.css', 'styles/h5p-confirmation-dialog.css',
  'styles/h5p-core-button.css', 'styles/h5p-theme.css',
  'styles/h5p-theme-variables.css', 'styles/h5p-tooltip.css', 'styles/h5p-table.css'
];

export function runtimeAssetUrl(base, asset) {
  return `${base}/${asset}?createRevision=${H5P_RUNTIME_REVISION}`;
}
