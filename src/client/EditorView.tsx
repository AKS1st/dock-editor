/**
 * Editor view: editable text editor for the file carried by the open seed.
 * - textarea editing with a manual undo/redo stack (Ctrl+Z / Ctrl+Y)
 * - Ctrl+S (and the toolbar button) saves through /desk-editor/fs.write
 * - toolbar (undo / redo / save) sits at the left of the title bar
 */
import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ViewProps, WorkbenchService } from './contract.ts'
import { useLocale, type T } from './hooks'
import { translate } from './i18n'
import { CodeMirrorEditor, type CodeMirrorControl } from './CodeMirrorEditor'
import { languageForPath } from './code'

/** The seed shape the file domain dispatches (EditorOpenSeed). */
interface OpenSeed {
  path?: string
  title?: string
  meta?: unknown
}

/** Persisted floating-window geometry for one file path. */
interface WindowGeometry {
  x: number
  y: number
  width: number
  height: number
}

/** localStorage key remembering the floating-window geometry per file path. */
const geometryKey = (path: string): string => `dock-editor:geometry:${path}`

function readGeometry(path: string): WindowGeometry | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(geometryKey(path))
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Partial<WindowGeometry>
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number'
      && typeof parsed.width === 'number' && typeof parsed.height === 'number') {
      return { x: parsed.x, y: parsed.y, width: parsed.width, height: parsed.height }
    }
    return null
  } catch {
    return null
  }
}

function writeGeometry(path: string, geometry: WindowGeometry): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(geometryKey(path), JSON.stringify(geometry))
  } catch {
    // Storage unavailable: geometry is forgotten on close, editing still works.
  }
}

interface ReadResponse {
  ok: boolean
  value?: { file: { content: string; truncated: boolean; binary: boolean; size: number }; writable?: boolean }
  error?: { code: string; message: string }
}

const INLINE = {
  wrap: { padding: '12px 16px', height: '100%', boxSizing: 'border-box' as const, display: 'flex', flexDirection: 'column' as const },
  head: { display: 'flex', alignItems: 'center', gap: 4, paddingBottom: 8, borderBottom: '1px solid var(--dsw-alias-border-l2, #d8dbe0)', marginBottom: 10, fontSize: 12, color: 'var(--dsw-alias-label-secondary, #656d76)' } as const,
  btn: { border: '1px solid var(--dsw-alias-border-l2, #d8dbe0)', background: 'transparent', color: 'var(--dsw-alias-label-primary, #1f2328)', borderRadius: 5, padding: '2px 8px', cursor: 'pointer', fontSize: 12, opacity: 1 } as const,
  btnDisabled: { opacity: 0.4, cursor: 'default' } as const,
  btnDirty: { background: 'var(--dsw-alias-interactive-bg-hover-accent, rgba(90,120,255,0.18))' } as const,
  btnActive: { background: 'var(--dsw-alias-interactive-bg-hover-accent, rgba(90,120,255,0.18))' } as const,
  title: { fontWeight: 600, color: 'var(--dsw-alias-label-primary, #1f2328)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, marginLeft: 8, flex: 1 },
  meta: { fontSize: 11 },
  area: { flex: 1, minHeight: 0, width: '100%', resize: 'none' as const, border: 0, outline: 'none', background: 'transparent', color: 'var(--dsw-alias-label-primary, #1f2328)', fontSize: 13, lineHeight: 1.6, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', whiteSpace: 'pre' as const, overflow: 'auto' },
  err: { color: '#d1242f', fontSize: 13 },
  empty: { color: 'var(--dsw-alias-label-secondary, #656d76)', fontSize: 13 },
}

export function EditorView(props: ViewProps): ReactNode {
  const { ctx, sessionId, active, seed, viewId } = props
  const openSeed = (seed ?? {}) as OpenSeed
  const path = openSeed.path
  const workbench = ctx.get<WorkbenchService>('workbench')

  const locale = useLocale(ctx)
  const t: T = useCallback((key: string, params?: Record<string, string | number>): string =>
    translate(locale, key, params), [locale])

  const [content, setContent] = useState<string | null>(null)
  const [binary, setBinary] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [size, setSize] = useState(0)
  /** False when the file lives outside the session workspace (saving stays
   *  workspace-confined, so the editor opens such files read-only). */
  const [writable, setWritable] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  /** Line wrapping for the CodeMirror editor; on by default. */
  const [wrap, setWrap] = useState(true)
  /** CodeMirror imperative surface: undo/redo/focus for every text file. */
  const codeRef = useRef<CodeMirrorControl | null>(null)
  const contentRef = useRef<string | null>(null)

  /** The CodeMirror language for the file, or null to edit as plain text. */
  const language = path !== undefined ? languageForPath(path) : null
  // Last geometry persisted for the current path (avoids redundant writes).
  const lastGeomRef = useRef<WindowGeometry | null>(null)
  // Last dirty value synced into the instance seed meta (avoids update loops).
  const lastDirtyRef = useRef<boolean | null>(null)

  /**
   * Resolve this view's own open instance id. The dock base hosts one
   * floating window per view (Phase F1) and hands views no instance id, so
   * the editor finds itself by matching its view id and seed path in the
   * current layout (floating window, else a legacy editor tab).
   */
  const ownInstance = useCallback((): string | undefined => {
    if (workbench === undefined || path === undefined) return undefined
    const layout = workbench.getLayout()
    const win = Object.values(layout.floatingWindows).find(
      (w) => w.viewId === viewId && (w.seed as OpenSeed | undefined)?.path === path,
    )
    if (win !== undefined) return win.instanceId
    return layout.editorTabs.find(
      (t) => t.viewId === viewId && (t.seed as OpenSeed | undefined)?.path === path,
    )?.instanceId
  }, [workbench, path, viewId])

  // Load the file when the seed path changes.
  useEffect(() => {
    if (path === undefined) return
    let cancelled = false
    lastDirtyRef.current = null
    setContent(null)
    setError(null)
    setDirty(false)
    setTruncated(false)
    setWritable(true)
    setSavedAt(null)
    codeRef.current = null
    setCanUndo(false)
    setCanRedo(false)
    void (async () => {
      try {
        const response = await fetch('/desk-editor/fs.read', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, path }),
        })
        const json = (await response.json()) as ReadResponse
        if (json.ok !== true || json.value === undefined) {
          throw new Error(json.error?.message ?? 'read failed')
        }
        if (cancelled) return
        const file = json.value.file
        contentRef.current = file.content
        setContent(file.content)
        setBinary(file.binary)
        setTruncated(file.truncated)
        setSize(file.size)
        setWritable(json.value.writable !== false)
      } catch (cause) {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => { cancelled = true }
  }, [path, sessionId])

  /**
   * Restore the remembered floating-window geometry for this file. The dock
   * base persists geometry per open instance (layout.floatingWindows), but a
   * closed window's geometry is discarded with it — so the editor re-applies
   * the last saved size/position per path on (re)open.
   */
  useEffect(() => {
    lastGeomRef.current = null
    if (path === undefined || workbench === undefined) return
    const saved = readGeometry(path)
    lastGeomRef.current = saved
    if (saved === null) return
    const instanceId = ownInstance()
    if (instanceId === undefined) return
    workbench.moveFloatingWindow(instanceId, saved.x, saved.y)
    workbench.resizeFloatingWindow(instanceId, saved.x, saved.y, saved.width, saved.height)
  }, [path, workbench, ownInstance])

  /**
   * Write geometry changes back to localStorage: dock notifies layout changes
   * while the user drags/resizes the floating window, so each change of this
   * file's window geometry is persisted under the path key.
   */
  useEffect(() => {
    if (workbench === undefined || path === undefined) return
    const listener = (): void => {
      const instanceId = ownInstance()
      if (instanceId === undefined) return
      const win = workbench.getLayout().floatingWindows[instanceId]
      if (win === undefined) return
      const current: WindowGeometry = { x: win.x, y: win.y, width: win.width, height: win.height }
      const last = lastGeomRef.current
      if (last === null) {
        // First observation: baseline only — don't persist the default geometry.
        lastGeomRef.current = current
        return
      }
      if (last.x === current.x && last.y === current.y && last.width === current.width && last.height === current.height) return
      lastGeomRef.current = current
      writeGeometry(path, current)
    }
    return workbench.onDidChangeLayout(listener)
  }, [path, workbench, ownInstance])

  /**
   * Keep the instance seed's meta dirty flag in sync (updateViewSeed) so the
   * beforeClose hook registered on the view definition can confirm closing
   * the floating window with unsaved changes.
   */
  useEffect(() => {
    if (workbench === undefined || path === undefined) return
    const instanceId = ownInstance()
    if (instanceId === undefined) return
    if (lastDirtyRef.current === dirty) return
    lastDirtyRef.current = dirty
    workbench.updateViewSeed(instanceId, { meta: { dirty } })
  }, [dirty, path, workbench, ownInstance])

  // Keep the ref in sync for the save flow.
  useEffect(() => { contentRef.current = content }, [content])

  /** CodeMirror doc change → sync the shared content/dirty state (the native
   *  history owns undo/redo; no manual stack). */
  const handleDocChanged = useCallback((next: string): void => {
    contentRef.current = next
    setContent(next)
    setDirty(true)
    setSavedAt(null)
  }, [])

  /** CodeMirror history depth → drive the toolbar undo/redo enabled state. */
  const handleHistoryChanged = useCallback((h: { canUndo: boolean; canRedo: boolean }): void => {
    setCanUndo(h.canUndo)
    setCanRedo(h.canRedo)
  }, [])

  /** Toolbar undo / redo: always the CodeMirror native history. */
  const invokeUndo = useCallback((): void => { codeRef.current?.undo() }, [])
  const invokeRedo = useCallback((): void => { codeRef.current?.redo() }, [])

  const save = useCallback(async (): Promise<void> => {
    if (path === undefined || contentRef.current === null || !dirty) return
    if (!writable) {
      // Outside-workspace files open read-only (host fs.write rejects them).
      setError(t('readOnly'))
      return
    }
    if (truncated) {
      // The file is larger than the editor's read cap: the buffer in memory
      // is only the first 256 KiB, so writing it back would silently
      // truncate the file. Refuse up front (the host enforces this too).
      setError(t('saveTooLarge'))
      return
    }
    setSaving(true)
    try {
      const response = await fetch('/desk-editor/fs.write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, path, content: contentRef.current }),
      })
      const json = (await response.json()) as { ok: boolean; error?: { message: string } }
      if (json.ok !== true) throw new Error(json.error?.message ?? 'save failed')
      setDirty(false)
      setSavedAt(Date.now())
      setSize(new TextEncoder().encode(contentRef.current).length)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }, [path, sessionId, dirty, truncated, writable, t])

  // Global shortcut while this view is on screen: Ctrl/Cmd+S saves, whether
  // focus is in the textarea, the CodeMirror editor, or a toolbar button.
  // CodeMirror's native history already owns Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z;
  // the textarea owner handles its own via onKeyDown below.
  useEffect(() => {
    if (!active || path === undefined) return
    const onKey = (event: KeyboardEvent): void => {
      const mod = event.ctrlKey || event.metaKey
      if (!mod) return
      if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, path, save])

  const title = openSeed.title ?? path?.split('/').pop() ?? 'No file'
  const btn = (label: string, action: () => void, disabled: boolean, extra?: object, btnTitle?: string): ReactNode =>
    createElement('button', {
      style: { ...INLINE.btn, ...(disabled ? INLINE.btnDisabled : {}), ...(extra ?? {}) },
      disabled,
      onClick: action,
      title: btnTitle,
    }, label)

  return createElement('div', { style: INLINE.wrap },
    createElement('div', { style: INLINE.head },
      // Toolbar (left): undo / redo / wrap / save.
      btn('↶', invokeUndo, !canUndo),
      btn('↷', invokeRedo, !canRedo),
      btn(t('wrap'), () => setWrap(v => !v), false, wrap ? INLINE.btnActive : undefined, wrap ? t('wrapTooltipOn') : t('wrapTooltipOff')),
      btn(t(saving ? 'saving' : (dirty ? 'saveDirty' : 'save')), () => void save(), !dirty || saving || truncated || !writable, dirty ? INLINE.btnDirty : undefined),
      createElement('span', { style: INLINE.title, title: path }, title),
      !writable
        ? createElement('span', { style: INLINE.meta }, t('readOnly'))
        : null,
      savedAt !== null
        ? createElement('span', { style: INLINE.meta }, t('savedAt', { time: new Date(savedAt).toLocaleTimeString() }))
        : null,
    ),
    truncated
      ? createElement('div', { style: INLINE.err }, t('truncatedNotice'))
      : null,
    error !== null
      ? createElement('div', { style: INLINE.err }, error)
      : content === null
        ? createElement('div', { style: INLINE.empty }, 'Reading…')
        : binary
          ? createElement('div', { style: INLINE.err }, 'Binary file — editing is not supported.')
          // Every text file gets the CodeMirror editor (incremental
          // highlighting for recognized code/config types, plain text
          // otherwise) so in-editor search/undo/redo work everywhere.
          // Keyed by path so it remounts per file.
          : createElement(CodeMirrorEditor, {
            key: path,
            initialContent: content,
            readOnly: !writable,
            language,
            wrap,
            t,
            onDocChanged: handleDocChanged,
            onHistoryChanged: handleHistoryChanged,
            controlRef: codeRef,
          }),
  )
}
