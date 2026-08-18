/**
 * Editor view (Phase 1: read-only text preview). Receives the open seed
 * ({ path, title }) carried by its tab; loads the file through
 * /desk-editor/fs.read. Editing/saving lands in a later phase.
 */
import { createElement, useEffect, useState, type ReactNode } from 'react'
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

const INLINE = {
  wrap: { padding: '12px 16px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' as const },
  head: { display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8, borderBottom: '1px solid var(--dsw-alias-border-l2, #d8dbe0)', marginBottom: 10, fontSize: 12, color: 'var(--dsw-alias-label-secondary, #656d76)' } as const,
  path: { fontWeight: 600, color: 'var(--dsw-alias-label-primary, #1f2328)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  meta: { marginLeft: 'auto' },
  body: { flex: 1, overflow: 'auto', margin: 0, fontSize: 13, lineHeight: 1.6, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const },
  err: { color: '#d1242f', fontSize: 13 },
  empty: { color: 'var(--dsw-alias-label-secondary, #656d76)', fontSize: 13 },
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function EditorView(props: ViewProps): ReactNode {
  const { ctx, sessionId, active, seed } = props
  const openSeed = (seed ?? {}) as OpenSeed
  const [content, setContent] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [binary, setBinary] = useState(false)
  const [size, setSize] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const path = openSeed.path
    if (path === undefined) return
    let cancelled = false
    setContent(null)
    setError(null)
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
        setContent(file.content)
        setTruncated(file.truncated)
        setBinary(file.binary)
        setSize(file.size)
      } catch (cause) {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => { cancelled = true }
  }, [openSeed.path, sessionId])

  const path = openSeed.path ?? 'No file'
  return createElement('div', { style: INLINE.wrap },
    createElement('div', { style: INLINE.head },
      createElement('span', { style: INLINE.path }, openSeed.title ?? path.split('/').pop() ?? path),
      binary ? createElement('span', { style: { color: '#d1242f' } }, 'binary') : null,
      createElement('span', { style: INLINE.meta }, formatSize(size)),
    ),
    error !== null
      ? createElement('div', { style: INLINE.err }, error)
      : content === null
        ? createElement('div', { style: INLINE.empty }, 'Reading…')
        : binary
          ? createElement('div', { style: INLINE.err }, 'Binary file — preview not available in Phase 1.')
          : createElement('pre', { style: INLINE.body },
            (truncated ? `… file truncated (${formatSize(size)}) — showing the first 256 KiB …\n\n` : '') + content,
          ),
  )
}
