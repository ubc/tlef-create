/** Keep the Blob URL alive while the browser hands the download to its file
 * saver. Revoking it in the click handler can cancel the transfer before any
 * bytes are read, particularly in an embedded browser. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  try {
    link.click();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    link.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
