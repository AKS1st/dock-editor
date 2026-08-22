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
import { createElement, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import type { EditorView } from '@codemirror/view'
import { SearchQuery, getSearchQuery, findNext, findPrevious, replaceNext, replaceAll, setSearchQuery } from '@codemirror/search'
import type { T } from './hooks'

interface Props {
  view: EditorView
  /** Initial section to reveal: 'find' only, or find + replace (Ctrl+H). */
  mode: 'find' | 'replace'
  count: number
  /** 1-based index of the match under the selection; 0 when none. */
  current: number
  t: T
  onClose: () => void
}

const BTN_CLASS = 'dock-search-btn'
const BTN_CSS = `.${BTN_CLASS}:hover{background:var(--dsw-alias-interactive-bg-hover-accent,rgba(90,120,255,0.18))}`
// Width of the replace-expand toggle; the replace row uses a spacer of the same
// width so the find and replace fields start at the same left x (aligned).
const TOGGLE_W = 26

// Crisp SVG icons for the replace actions (the ⇄ / ⇊ glyphs rendered as text
// looked ambiguous). compare_arrows = replace one; done_all = replace all.
const IC_REPLACE = 'M9.01 14H2v2h7.01v3L13 15l-3.99-4v3zm5.98-1v-3H22V8h-7.01V5L11 9l3.99 4z'
const IC_REPLACE_ALL = 'M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z'
// VSCode-style expand/collapse chevron for the replace section: a stroke chevron
// that points right (expand) when collapsed and down (collapse) when open.
const IC_CHEVRON_RIGHT = 'M9 6l6 6-6 6'
const IC_CHEVRON_DOWN = 'M6 9l6 6 6-6'

const S = {
  wrap: { position: 'absolute' as const, top: 8, right: 12, zIndex: 20, display: 'flex', flexDirection: 'column' as const, gap: 6, background: 'var(--dsw-alias-bg-layer-2, #ffffff)', color: 'var(--dsw-alias-label-primary, #1f2328)', border: '1px solid var(--dsw-alias-border-l2, #d8dbe0)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.14)', padding: '8px 8px', fontSize: 13 },
  row: { display: 'flex', alignItems: 'center', gap: 4 },
  input: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13, color: 'var(--dsw-alias-label-primary, #1f2328)', background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #d8dbe0)', borderRadius: 4, padding: '2px 6px', outline: 'none', width: 200, height: 24, boxSizing: 'border-box' as const, flexShrink: 0 },
  iconBtn: { border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-secondary, #656d76)', cursor: 'pointer', padding: '2px 5px', borderRadius: 4, fontSize: 13, lineHeight: 1, display: 'inline-flex', alignItems: 'center' } as const,
  textBtn: { border: '1px solid var(--dsw-alias-border-l2, #d8dbe0)', background: 'transparent', color: 'var(--dsw-alias-label-secondary, #656d76)', cursor: 'pointer', borderRadius: 4, padding: '2px 8px', fontSize: 13, whiteSpace: 'nowrap' as const },
  spacer: { width: TOGGLE_W, flexShrink: 0 } as const,
  count: { color: 'var(--dsw-alias-label-secondary, #656d76)', fontSize: 11, minWidth: 40, textAlign: 'right' as const, paddingRight: 2 },
}

const safe = <A extends unknown[], R>(fn: (...args: A) => R): ((...args: A) => R | undefined) => {
  try { return fn } catch { return () => undefined }
}

export function SearchWidget(props: Props): ReactNode {
  const { view, mode, count, current, t, onClose } = props
  const query = getSearchQuery(view.state)
  const [search, setSearch] = useState(query.search)
  const [replace, setReplace] = useState(query.replace)
  const [replaceOpen, setReplaceOpen] = useState(mode === 'replace')
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const readOnly = view.state.readOnly

  useEffect(() => {
    try { searchRef.current?.focus(); searchRef.current?.select() } catch { /* ignore */ }
  }, [])

  // Wheel over the widget scrolls the editor scroller, not the page.
  const onWheel = useCallback((event: WheelEvent): void => {
    try {
      event.preventDefault()
      event.stopPropagation()
      const scroller = view.scrollDOM
      if (scroller !== null) scroller.scrollTop += event.deltaY
    } catch { /* ignore */ }
  }, [view])
  useEffect(() => {
    const el = wrapRef.current
    if (el === null) return
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onWheel])

  const dispatchQuery = useCallback((s: string, r: string): void => {
    try { view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: s, replace: r })) }) } catch { /* ignore */ }
  }, [view])

  const onSearchInput = useCallback((value: string): void => { setSearch(value); dispatchQuery(value, replace) }, [dispatchQuery, replace])
  const onReplaceInput = useCallback((value: string): void => { setReplace(value); dispatchQuery(search, value) }, [dispatchQuery, search])

  // Guard: only navigate/replace when the query is valid, so an empty query
  // never falls through to CM's searchCommand → openSearchPanel → appendConfig.
  const queryValid = useCallback((): boolean => { try { return getSearchQuery(view.state).valid } catch { return false } }, [view])
  const next = useCallback((): void => { if (queryValid()) safe(() => findNext(view))() }, [view, queryValid])
  const prev = useCallback((): void => { if (queryValid()) safe(() => findPrevious(view))() }, [view, queryValid])
  const goNextEnter = useCallback((shift: boolean): void => { if (!queryValid()) return; if (shift) safe(() => findPrevious(view))(); else safe(() => findNext(view))() }, [view, queryValid])

  const replaceOne = useCallback((): void => {
    if (!queryValid()) return
    try { dispatchQuery(search, replace); replaceNext(view) } catch { /* ignore */ }
  }, [view, search, replace, dispatchQuery, queryValid])

  const replaceEvery = useCallback((): void => {
    if (!queryValid()) return
    try { dispatchQuery(search, replace); replaceAll(view) } catch { /* ignore */ }
  }, [view, search, replace, dispatchQuery, queryValid])

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') { event.preventDefault(); goNextEnter(event.shiftKey) }
    else if (event.key === 'Escape') { event.preventDefault(); onClose() }
  }, [goNextEnter, onClose])

  const iconBtn = (label: string, title: string, action: () => void, extra?: object): ReactNode =>
    createElement('button', { type: 'button', className: BTN_CLASS, title, style: { ...S.iconBtn, ...(extra ?? {}) }, onClick: action }, label)

  const svgIconBtn = (path: string, title: string, action: () => void): ReactNode =>
    createElement('button', { type: 'button', className: BTN_CLASS, title, style: S.iconBtn, onClick: action },
      createElement('svg', { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'currentColor', style: { display: 'block' } },
        createElement('path', { d: path })))

  return createElement('div', { ref: wrapRef, style: S.wrap },
    createElement('style', null, BTN_CSS),
    createElement('div', { style: S.row },
      !readOnly
        ? createElement('button', {
          type: 'button', className: BTN_CLASS, title: t('searchReplace'),
          style: { ...S.iconBtn, width: TOGGLE_W, flexShrink: 0, color: replaceOpen ? 'var(--dsw-alias-interactive-bg-hover-accent, #5a78ff)' : undefined },
          onClick: () => setReplaceOpen((v) => !v),
        }, createElement('svg', { viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'block' } },
          createElement('path', { d: replaceOpen ? IC_CHEVRON_DOWN : IC_CHEVRON_RIGHT })))
        : null,
      createElement('input', {
        ref: searchRef, style: S.input, placeholder: t('searchFind'), value: search, spellCheck: false,
        onChange: (e: { target: { value: string } }) => onSearchInput(e.target.value), onKeyDown,
      }),
      createElement('span', { style: S.count }, count > 0 ? `${current}/${count}` : t('searchNoMatch')),
      iconBtn('↑', t('searchPrev'), prev),
      iconBtn('↓', t('searchNext'), next),
      iconBtn('×', t('searchClose'), onClose),
    ),
    !readOnly && replaceOpen
      ? createElement('div', { style: S.row },
        createElement('div', { style: S.spacer }),
        createElement('input', {
          style: S.input, placeholder: t('searchReplace'), value: replace, spellCheck: false,
          onChange: (e: { target: { value: string } }) => onReplaceInput(e.target.value), onKeyDown,
        }),
        svgIconBtn(IC_REPLACE, t('searchReplaceOne'), replaceOne),
        svgIconBtn(IC_REPLACE_ALL, t('searchReplaceAll'), replaceEvery),      )
      : null,
  )
}
