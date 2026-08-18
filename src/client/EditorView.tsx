/**
 * Editor view: editable text editor for the file carried by the open seed.
 * - textarea editing with a manual undo/redo stack (Ctrl+Z / Ctrl+Y)
 * - Ctrl+S (and the toolbar button) saves through /desk-editor/fs.write
 * - toolbar (undo / redo / save) sits at the left of the title bar
 */
import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ViewProps, WorkbenchService } from 'dock/client/contract'

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
  value?: { file: { content: string; truncated: boolean; binary: boolean; size: number } }
  error?: { code: string; message: string }
}

/** Undo/redo stack bound: snapshots of previous values. */
const STACK_LIMIT = 100

const INLINE = {
  wrap: { padding: '12px 16px', height: '100%', boxSizing: 'border-box' as const, display: 'flex', flexDirection: 'column' as const },
  head: { display: 'flex', alignItems: 'center', gap: 4, paddingBottom: 8, borderBottom: '1px solid var(--dsw-alias-border-l2, #d8dbe0)', marginBottom: 10, fontSize: 12, color: 'var(--dsw-alias-label-secondary, #656d76)' } as const,
  btn: { border: '1px solid var(--dsw-alias-border-l2, #d8dbe0)', background: 'transparent', color: 'var(--dsw-alias-label-primary, #1f2328)', borderRadius: 5, padding: '2px 8px', cursor: 'pointer', fontSize: 12, opacity: 1 } as const,
  btnDisabled: { opacity: 0.4, cursor: 'default' } as const,
  btnDirty: { background: 'var(--dsw-alias-interactive-bg-hover-accent, rgba(90,120,255,0.18))' } as const,
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

  const [content, setContent] = useState<string | null>(null)
  const [binary, setBinary] = useState(false)
  const [size, setSize] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const undoRef = useRef<string[]>([])
  const redoRef = useRef<string[]>([])
  const contentRef = useRef<string | null>(null)
  // Last geometry persisted for the current path (avoids redundant writes).
  const lastGeomRef = useRef<WindowGeometry | null>(null)
  // Last dirty value synced into the instance seed meta (avoids update loops).
  const lastDirtyRef = useRef<boolean | null>(null)

  const syncStacks = (): void => {
    setCanUndo(undoRef.current.length > 0)
    setCanRedo(redoRef.current.length > 0)
  }

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
    setSavedAt(null)
    undoRef.current = []
    redoRef.current = []
    syncStacks()
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
        setSize(file.size)
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
    workbench.resizeFloatingWindow(instanceId, saved.width, saved.height)
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

  // Keep the ref in sync for the keydown handlers.
  useEffect(() => { contentRef.current = content }, [content])

  /** Push the current value onto the undo stack, then apply the edit. */
  const edit = useCallback((next: string): void => {
    const current = contentRef.current
    if (current === null) return
    undoRef.current.push(current)
    if (undoRef.current.length > STACK_LIMIT) undoRef.current.shift()
    redoRef.current = []
    contentRef.current = next
    setContent(next)
    setDirty(true)
    syncStacks()
  }, [])

  const undo = useCallback((): void => {
    const prev = undoRef.current.pop()
    const current = contentRef.current
    if (prev === undefined || current === null) return
    redoRef.current.push(current)
    contentRef.current = prev
    setContent(prev)
    setDirty(true)
    syncStacks()
  }, [])

  const redo = useCallback((): void => {
    const next = redoRef.current.pop()
    const current = contentRef.current
    if (next === undefined || current === null) return
    undoRef.current.push(current)
    contentRef.current = next
    setContent(next)
    setDirty(true)
    syncStacks()
  }, [])

  const save = useCallback(async (): Promise<void> => {
    if (path === undefined || contentRef.current === null || !dirty) return
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
  }, [path, sessionId, dirty])

  // Global shortcuts while this view is on screen.
  useEffect(() => {
    if (!active || path === undefined) return
    const onKey = (event: KeyboardEvent): void => {
      const mod = event.ctrlKey || event.metaKey
      if (!mod) return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        void save()
      } else if (key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (key === 'y') {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, path, save, undo, redo])

  const title = openSeed.title ?? path?.split('/').pop() ?? 'No file'
  const btn = (label: string, action: () => void, disabled: boolean, extra?: object): ReactNode =>
    createElement('button', {
      style: { ...INLINE.btn, ...(disabled ? INLINE.btnDisabled : {}), ...(extra ?? {}) },
      disabled,
      onClick: action,
    }, label)

  return createElement('div', { style: INLINE.wrap },
    createElement('div', { style: INLINE.head },
      // Toolbar (left): undo / redo / save.
      btn('↶', undo, !canUndo),
      btn('↷', redo, !canRedo),
      btn(saving ? '保存中…' : (dirty ? '保存 ●' : '保存'), () => void save(), !dirty || saving, dirty ? INLINE.btnDirty : undefined),
      createElement('span', { style: INLINE.title, title: path }, title),
      savedAt !== null
        ? createElement('span', { style: INLINE.meta }, `已保存 ${new Date(savedAt).toLocaleTimeString()}`)
        : null,
    ),
    error !== null
      ? createElement('div', { style: INLINE.err }, error)
      : content === null
        ? createElement('div', { style: INLINE.empty }, 'Reading…')
        : binary
          ? createElement('div', { style: INLINE.err }, 'Binary file — editing is not supported.')
          : createElement('textarea', {
            style: INLINE.area,
            spellCheck: false,
            value: content,
            onChange: (event: { target: { value: string } }) => edit(event.target.value),
          }),
  )
}
