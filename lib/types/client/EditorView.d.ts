/**
 * Editor view: editable text editor for the file carried by the open seed.
 * - textarea editing with a manual undo/redo stack (Ctrl+Z / Ctrl+Y)
 * - Ctrl+S (and the toolbar button) saves through /desk-editor/fs.write
 * - toolbar (undo / redo / save) sits at the left of the title bar
 */
import { type ReactNode } from 'react';
import type { ViewProps } from './contract.ts';
export declare function EditorView(props: ViewProps): ReactNode;
