/**
 * CodeMirror 6 wrapper used by the editor view for every text file.
 *
 * The editor is uncontrolled: CodeMirror owns the document after mount, so
 * `initialContent` is read only once (the parent keys this component by file
 * path to remount on file change). Content edits and the undo/redo history
 * depth are reported out through callbacks so the parent keeps the shared
 * dirty flag, the toolbar buttons, and the save flow in sync with the native
 * history (no manual undo/redo stack).
 *
 * In-editor search is a DECOUPLED, self-owned SearchWidget (a plain React
 * overlay, NOT a CM showPanel). It thus reserves no editor layout — no
 * drag-select auto-scroll, no scrollToMatch overshoot, no replace-row collapse.
 * It drives CM's search API through the search() search state; the match
 * highlighting/count is a ViewPlugin; and every navigation/replace command in
 * the widget AND the keymap is guarded by a valid-query check so an empty query
 * never reaches CM's searchCommand → openSearchPanel → appendConfig
 * reconfiguration (the earlier white-screen vector). All plugin/keymap body is
 * defensive (try/catch) so nothing throws into the update cycle.
 */
import { type MutableRefObject, type ReactNode } from 'react';
import { type Extension } from '@codemirror/state';
import type { T } from './hooks';
/** Imperative surface the editor view's toolbar buttons drive. */
export interface CodeMirrorControl {
    undo(): void;
    redo(): void;
    focus(): void;
}
interface Props {
    initialContent: string;
    readOnly: boolean;
    /** Language extension for the file, or null to edit as plain text. */
    language: Extension | null;
    /** Line wrapping enabled (default on). Toggled from the toolbar. */
    wrap: boolean;
    t: T;
    onDocChanged: (content: string) => void;
    onHistoryChanged: (history_: {
        canUndo: boolean;
        canRedo: boolean;
    }) => void;
    controlRef: MutableRefObject<CodeMirrorControl | null>;
}
export declare function CodeMirrorEditor(props: Props): ReactNode;
export {};
