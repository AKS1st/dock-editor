/**
 * dock-editor code-source recognition: which file extensions get the
 * CodeMirror 6 editor (incremental syntax highlighting) and which language
 * each maps to.
 *
 * This is the single source of truth for "is this a code file" — the editor
 * view decides textarea vs. CodeMirror through `languageForPath`, and the
 * explorer icons are registered from the same extension families below. Keep
 * the two in bus: every extension that gets a language is also in a family.
 */
import type { Extension } from '@codemirror/state';
/**
 * Source/config family list, each with its explorer icon tint. Kept here so
 * icons (registered once against dock-files) and CodeMirror highlighting
 * (per-open-view) agree on what the editor owns. Colors mirror the dock-files
 * built-in palette.
 */
export declare const CODE_FAMILIES: {
    exts: string[];
    color: string;
}[];
/** Member families flattened to a set of lowercase extension strings. */
export declare const CODE_EXTENSIONS: ReadonlySet<string>;
/** Whether a file path is a code/config type this editor highlights. */
export declare function isCodePath(path: string): boolean;
/**
 * The CodeMirror 6 language extension for a path, or null when the file type
 * is not recognized (the caller then keeps the plain textarea). Language
 * selection is by extension, matching the icons above.
 */
export declare function languageForPath(path: string): Extension | null;
