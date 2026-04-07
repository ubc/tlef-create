// Bridge: expose jQuery as H5P.jQuery before h5p.js loads
var H5P = window.H5P = window.H5P || {};
H5P.jQuery = jQuery;
