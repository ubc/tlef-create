/**
 * H5P previews run in a script-enabled sandbox without a same-origin grant.
 * Browsers therefore treat the preview document as an opaque origin and apply
 * CORS to font files referenced by H5P library CSS. These assets are public,
 * immutable runtime files, so explicitly allow sandboxed players to read them
 * while keeping authored content isolated from the CREATE application.
 */
export function allowSandboxedH5PAsset(_req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}
