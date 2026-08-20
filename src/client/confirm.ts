/**
 * Themed in-app confirm dialog for dock-editor, replacing the native
 * `window.confirm` (which clashes with the DSH UI). Mounts a small modal
 * into <body> through react-dom and resolves with the user's choice; uses
 * the same DSH theme tokens as the editor's inline styles.
 */
import { createElement, useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

interface ConfirmProps {
  message: string
  labels?: { ok?: string; cancel?: string }
  onResult: (confirmed: boolean) => void
}

const BACKDROP: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10001,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0, 0, 0, 0.35)',
}

const CARD: CSSProperties = {
  minWidth: 260,
  maxWidth: 420,
  boxSizing: 'border-box',
  padding: '14px 16px',
  borderRadius: 10,
  fontSize: 13,
  color: 'var(--dsw-alias-label-primary, #1f2328)',
  background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
  border: '1px solid var(--dsw-alias-border-l2, #d8dbe0)',
  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.25)',
}

const BODY: CSSProperties = {
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}

const ACTIONS: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 14,
}

const BTN: CSSProperties = {
  padding: '5px 14px',
  border: '1px solid var(--dsw-alias-border-l2, #d8dbe0)',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
  color: 'var(--dsw-alias-label-primary, #1f2328)',
  background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
}

const BTN_PRIMARY: CSSProperties = {
  ...BTN,
  borderColor: 'transparent',
  color: '#ffffff',
  background: '#0969da',
}

function ConfirmDialog(props: ConfirmProps): ReactNode {
  const { message, labels, onResult } = props
  const okRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    okRef.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onResult(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onResult])
  return createElement('div', { style: BACKDROP, onMouseDown: () => onResult(false) },
    createElement('div', { style: CARD, onMouseDown: (event: MouseEvent) => event.stopPropagation() },
      createElement('div', { style: BODY }, message),
      createElement('div', { style: ACTIONS },
        createElement('button', { style: BTN, onClick: () => onResult(false) }, labels?.cancel ?? 'Cancel'),
        createElement('button', { ref: okRef, style: BTN_PRIMARY, onClick: () => onResult(true) }, labels?.ok ?? 'OK'),
      ),
    ),
  )
}

/** Show a themed confirm; resolves true on 确定, false on 取消 / Esc / backdrop.
 *  `labels` carries already-translated button text (defaults 'OK' / 'Cancel'). */
export function confirmDialog(message: string, labels?: { ok?: string; cancel?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const finish = (confirmed: boolean): void => {
      root.unmount()
      host.remove()
      resolve(confirmed)
    }
    root.render(createElement(ConfirmDialog, { message, labels, onResult: finish }))
  })
}
