/**
 * Editor view: editable text editor for the file carried by the open seed.
 * - textarea editing with a manual undo/redo stack (Ctrl+Z / Ctrl+Y)
 * - Ctrl+S (and the toolbar button) saves through /desk-editor/fs.write
 * - toolbar (undo / redo / save) sits at the left of the title bar
 */
import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ViewProps } from 'desk/client/contract'

/** The seed shape the file domain dispatches (EditorOpenSeed). */
interface OpenSeed {
  path?: string
  title?: string
  meta?: unknown
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
  const { ctx, sessionId, active, seed } = props
  const openSeed = (seed ?? {}) as OpenSeed
  const path = openSeed.path

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

  const syncStacks = (): void => {
    setCanUndo(undoRef.current.length > 0)
    setCanRedo(redoRef.current.length > 0)
  }

  // Load the file when the seed path changes.
  useEffect(() => {
    if (path === undefined) return
    let cancelled = false
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
    if (path === undefined || contentRef.current === null) return
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
  }, [path, sessionId])

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
      btn(saving ? '保存中…' : (dirty ? '保存 ●' : '保存'), () => void save(), saving, dirty ? INLINE.btnDirty : undefined),
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
