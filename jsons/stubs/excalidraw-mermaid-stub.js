/**
 * Stub for `@excalidraw/mermaid-to-excalidraw`.
 *
 * Excalidraw reaches mermaid only through a lazy dynamic import inside its "Mermaid to
 * Excalidraw" dialog loader:  import("@excalidraw/mermaid-to-excalidraw")
 *
 * That dialog is not reachable in this app (canvasActions are disabled and the feature is
 * not exposed), but rolldown still resolves the dynamic import at build time and pulls in
 * the whole mermaid subtree — mermaid + @mermaid-js/parser + chevrotain + d3 + dompurify,
 * 130-odd chunks. On Vite 8 / rolldown that aborted the production build with
 * "[Panic in async function] code: 'GenericFailure'", reproducibly, with a raised heap.
 *
 * Aliasing the specifier here keeps the exact same call sites working: the loader still
 * resolves its import and still gets an object, and only a user who actually opens the
 * Mermaid dialog sees the error. Everything else in Excalidraw is unaffected.
 *
 * If mermaid support is ever wanted, remove the alias in jsons/vite.config.ts and verify
 * the build, because the panic is a bundler problem, not a code problem.
 */
const unsupported = () => {
  throw new Error(
    'Mermaid diagrams are not supported in this build of Senior Law Partner.',
  );
};

export const mermaidToExcalidraw = unsupported;
export const parseMermaidToExcalidraw = unsupported;
export const parseMermaid = unsupported;

export default {
  mermaidToExcalidraw: unsupported,
  parseMermaidToExcalidraw: unsupported,
  parseMermaid: unsupported,
};
