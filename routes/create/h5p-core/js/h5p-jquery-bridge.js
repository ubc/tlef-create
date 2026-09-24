// Preserve the official core's noConflict instance; older bundles exposed only
// window.jQuery. Never replace a working H5P instance with an undefined global.
var H5P = window.H5P = window.H5P || {};
H5P.jQuery = H5P.jQuery || window.jQuery;
