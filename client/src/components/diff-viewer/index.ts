/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component + the DiffCommentApi contract, plus
   the parsing/style primitives other diff-shaped viewers (e.g. Smart Diff)
   reuse so they render identically without deep-importing past this barrel. */
export { DiffViewer } from "./DiffViewer";
export type { DiffCommentApi } from "./comments";
export { parsePatch, type Line } from "./helpers";
export { s as diffStyles, chevronFor, lineRowFor, lineSignFor } from "./styles";
export { AUTO_EXPAND_MAX_LINES } from "./constants";
