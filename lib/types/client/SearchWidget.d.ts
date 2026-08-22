/**
 * Decoupled, self-owned search widget for the dock editor.
 *
 * This is a normal React element that floats top-right — it is NOT a CodeMirror
 * `showPanel`, so it reserves no editor layout (no drag-select auto-scroll, no
 * scrollToMatch overshoot). It drives CodeMirror's search API directly via the
 * search() search state, and every navigation/replace command is guarded by a
 * valid-query check so an empty query never reaches CM's searchCommand →
 * openSearchPanel → appendConfig reconfiguration (a white-screen source).
 *
 * Commands are wrapped defensively: any unexpected error is swallowed rather
 * than thrown into the editor/update cycle.
 */
import { type ReactNode } from 'react';
import type { EditorView } from '@codemirror/view';
import type { T } from './hooks';
interface Props {
    view: EditorView;
    /** Initial section to reveal: 'find' only, or find + replace (Ctrl+H). */
    mode: 'find' | 'replace';
    count: number;
    /** 1-based index of the match under the selection; 0 when none. */
    current: number;
    t: T;
    onClose: () => void;
}
export declare function SearchWidget(props: Props): ReactNode;
export {};
