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
import { createElement, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { EditorState, Compartment, RangeSetBuilder, type Extension } from '@codemirror/state'
import {
  EditorView,
  ViewPlugin,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightActiveLine,
  highlightSpecialChars,
  drawSelection,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import {
  history,
  historyKeymap,
  defaultKeymap,
  indentWithTab,
  undo,
  redo,
  undoDepth,
  redoDepth,
  moveLineUp,
  moveLineDown,
  toggleComment,
  toggleBlockComment,
} from '@codemirror/commands'
import { bracketMatching, foldGutter, syntaxHighlighting, indentOnInput } from '@codemirror/language'
import { search, SearchQuery, getSearchQuery, findNext, findPrevious, setSearchQuery } from '@codemirror/search'
import type { T } from './hooks'
import { SearchWidget } from './SearchWidget'
import { editorTheme, editorHighlightStyle } from './theme'

/** Imperative surface the editor view's toolbar buttons drive. */
export interface CodeMirrorControl {
  undo(): void
  redo(): void
  focus(): void
}

interface Props {
  initialContent: string
  readOnly: boolean
  /** Language extension for the file, or null to edit as plain text. */
  language: Extension | null
  /** Line wrapping enabled (default on). Toggled from the toolbar. */
  wrap: boolean
  t: T
  onDocChanged: (content: string) => void
  onHistoryChanged: (history_: { canUndo: boolean; canRedo: boolean }) => void
  controlRef: MutableRefObject<CodeMirrorControl | null>
}

/** Container fills the flex column under the toolbar and scrolls internally. */
const CONTAINER: { flex: number; minHeight: 0; width: string; height: string; overflow: 'hidden'; position: string } =
  { flex: 1, minHeight: 0, width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }

/** Inner mount box CodeMirror renders into (fills the relative container). */
const MOUNT: { width: string; height: string } = { width: '100%', height: '100%' }

/** Extra common editor keybindings on top of CodeMirror's own keymaps. */
const EXTRA_KEYMAP = [
  { key: 'Alt-ArrowUp', run: moveLineUp },
  { key: 'Alt-ArrowDown', run: moveLineDown },
  { key: 'Mod-/', run: toggleComment },
  { key: 'Mod-Shift-/', run: toggleBlockComment },
]

// Guarded navigation: never run searchCommand's openSearchPanel fallback.
const guardedFindNext = (view: EditorView): boolean => {
  try { return getSearchQuery(view.state).valid ? findNext(view) : false } catch { return false }
}
const guardedFindPrevious = (view: EditorView): boolean => {
  try { return getSearchQuery(view.state).valid ? findPrevious(view) : false } catch { return false }
}

// ── Search match highlighting + count (replaces the built-in panel) ───────

const matchMark = Decoration.mark({ class: 'cm-searchMatch' })
const currentMatchMark = Decoration.mark({ class: 'cm-searchMatch cm-searchMatch-selected' })

const searchMatches = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  count = 0
  /** 1-based index of the match under the selection; 0 when none. */
  current = 0

  constructor(view: EditorView) {
    this.decorations = this.compute(view)
  }

  update(u: ViewUpdate): void {
    try {
      const q = getSearchQuery(u.state)
      const q0 = getSearchQuery(u.startState)
      if (u.docChanged || u.selectionSet || u.viewportChanged || q.search !== q0.search || q.replace !== q0.replace) {
        this.decorations = this.compute(u.view)
      }
    } catch { /* defensive */ }
  }

  compute(view: EditorView): DecorationSet {
    try {
      const q = getSearchQuery(view.state)
      if (!q.valid) {
        this.count = 0
        this.current = 0
        return Decoration.none
      }
      const sel = view.state.selection.main
      const selFrom = sel.from
      const selTo = sel.to

      let count = 0
      let current = 0
      const all = q.getCursor(view.state)
      let result = all.next()
      while (!result.done) {
        count++
        const { from, to } = result.value
        if (current === 0 && from <= selFrom && selTo <= to) current = count
        result = all.next()
      }
      this.count = count
      this.current = current

      const builder = new RangeSetBuilder<Decoration>()
      for (const r of view.visibleRanges) {
        const cur = q.getCursor(view.state, r.from, r.to)
        let res = cur.next()
        while (!res.done) {
          const { from, to } = res.value
          builder.add(from, to, current !== 0 && from <= selFrom && selTo <= to ? currentMatchMark : matchMark)
          res = cur.next()
        }
      }
      return builder.finish()
    } catch {
      this.count = 0
      this.current = 0
      return Decoration.none
    }
  }
}, {
  decorations: (v) => v.decorations,
})

export function CodeMirrorEditor(props: Props): ReactNode {
  const { initialContent, readOnly, language, wrap, t, onDocChanged, onHistoryChanged, controlRef } = props
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const readOnlyCompartment = useRef(new Compartment())
  const wrapCompartment = useRef(new Compartment())

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchMode, setSearchMode] = useState<'find' | 'replace'>('find')
  const [searchCount, setSearchCount] = useState(0)
  const [searchCurrent, setSearchCurrent] = useState(0)

  const onDocChangedRef = useRef(onDocChanged)
  onDocChangedRef.current = onDocChanged
  const onHistoryChangedRef = useRef(onHistoryChanged)
  onHistoryChangedRef.current = onHistoryChanged
  const openSearchRef = useRef<(mode: 'find' | 'replace') => void>(() => {})
  const closeSearchRef = useRef<() => void>(() => {})
  const onSearchRef = useRef<(s: { count: number; current: number }) => void>(() => {})
  onSearchRef.current = (s) => {
    setSearchCount(s.count)
    setSearchCurrent(s.current)
  }

  openSearchRef.current = (mode) => { setSearchMode(mode); setSearchOpen(true) }

  closeSearchRef.current = () => {
    setSearchOpen(false)
    const view = viewRef.current
    if (view !== null) {
      try { view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) }) } catch { /* ignore */ }
    }
  }

  useEffect(() => {
    const parent = containerRef.current
    if (parent === null) return
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      syntaxHighlighting(editorHighlightStyle),
      editorTheme,
      ...(language === null ? [] : [language]),
      search(),
      searchMatches,
      readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
      wrapCompartment.current.of(wrap ? EditorView.lineWrapping : []),
      keymap.of([
        { key: 'Mod-f', run: () => { try { openSearchRef.current('find'); return true } catch { return false } } },
        { key: 'Mod-h', run: () => { try { openSearchRef.current('replace'); return true } catch { return false } } },
        { key: 'F3', run: guardedFindNext, shift: guardedFindPrevious, preventDefault: true },
        { key: 'Mod-g', run: guardedFindNext, shift: guardedFindPrevious, preventDefault: true },
        { key: 'Escape', run: () => { try { closeSearchRef.current(); return true } catch { return false } }, preventDefault: true },
        ...historyKeymap,
        ...defaultKeymap,
        ...EXTRA_KEYMAP,
        indentWithTab,
      ]),
      EditorView.contentAttributes.of({ spellcheck: 'false' }),
      EditorView.updateListener.of((update) => {
        try {
          if (update.docChanged) onDocChangedRef.current(update.state.doc.toString())
          onHistoryChangedRef.current({ canUndo: undoDepth(update.state) > 0, canRedo: redoDepth(update.state) > 0 })
          const plugin = update.view.plugin(searchMatches)
          if (plugin !== null) onSearchRef.current({ count: plugin.count, current: plugin.current })
        } catch { /* defensive */ }
      }),
    ]
    const state = EditorState.create({ doc: initialContent, extensions })
    const view = new EditorView({ state, parent })
    viewRef.current = view
    view.focus()
    controlRef.current = {
      undo: () => void undo(view),
      redo: () => void redo(view),
      focus: () => view.focus(),
    }
    return () => {
      controlRef.current = null
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    try { view.dispatch({ effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly)) }) } catch { /* ignore */ }
  }, [readOnly])

  // Line wrapping: default on, toggled from the toolbar. The compartment lets
  // the editor switch between wrap and horizontal-scroll without a remount.
  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    try { view.dispatch({ effects: wrapCompartment.current.reconfigure(wrap ? EditorView.lineWrapping : []) }) } catch { /* ignore */ }
  }, [wrap])

  // While the search widget is open the editor's own text caret is distracting
  // (it blinks in the content, left of the floating widget). Blur the editor
  // content so only the search input shows a caret.
  useEffect(() => {
    if (searchOpen) {
      try { viewRef.current?.contentDOM.blur() } catch { /* ignore */ }
    }
  }, [searchOpen])

  return createElement('div', { style: CONTAINER },
    createElement('div', { ref: containerRef, style: MOUNT }),
    searchOpen && viewRef.current !== null
      ? createElement(SearchWidget, {
        view: viewRef.current,
        mode: searchMode,
        count: searchCount,
        current: searchCurrent,
        t,
        onClose: () => closeSearchRef.current(),
      })
      : null,
  )
}
