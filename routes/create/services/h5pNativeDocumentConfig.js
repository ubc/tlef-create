/**
 * Resolve the effective native H5P container shared by Preview, Studio, and
 * package export. Canvas mixed activities use a Column only when converted to
 * a native H5P document.
 */
export function resolveNativeH5PContainerMode(quiz, override) {
  const requestedMode = override
    || quiz?.settings?.targetFormat
    || quiz?.containerMode
    || 'column';

  return requestedMode === 'mixed-activity' ? 'column' : requestedMode;
}
