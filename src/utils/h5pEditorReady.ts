interface EditorRuntime {
  $?: { active?: number };
  libraryCache?: Record<string, unknown>;
  libraryLoaded?: Record<string, boolean>;
}
type EditorElement = HTMLElement & { editorInstance?: { iframeWindow?: { H5PEditor?: EditorRuntime } } };

// Lumi's loaded event announces the root form, before nested forms finish
// fetching their semantics/scripts. Do not expose Save while those are loading.
export async function waitForH5PEditorAssets(element: EditorElement | null, active: () => boolean) {
  const deadline = Date.now() + 15000;
  while (active()) {
    const runtime = element?.editorInstance?.iframeWindow?.H5PEditor;
    const pending = runtime && ((runtime.$?.active || 0) > 0 ||
      Object.entries(runtime.libraryCache || {}).some(([name, value]) => value === 0 || !runtime.libraryLoaded?.[name]));
    if (!pending) return true;
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}
