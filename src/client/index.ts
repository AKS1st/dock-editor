/**
 * Client half of desk-editor: registers the 'editor' file viewer against the
 * desk-files file domain (as the default viewer) and the matching editor-area
 * view against desk. The view renders a file's text content (read-only in
 * Phase 1) fetched through its own /desk-editor/fs.read host route.
 */
import type {} from 'desk/client/contract'
import type { WorkbenchContext, WorkbenchService } from 'desk/client/contract'
import { EditorView } from './EditorView'

/** Requires the workbench base (carrier) and the desk-files file domain. */
export const inject = ['workbench']

/** Local structural face of ctx.files (avoid type dependency on desk-files). */
interface FilesService {
  registerFileViewer(def: { id: string; exts?: string[]; default?: boolean }): () => void
}

/** Client plugin body. */
export function apply(ctx: WorkbenchContext): void {
  const workbench = ctx.get<WorkbenchService>('workbench')
  if (workbench === undefined) return
  const files = ctx.get<FilesService>('files')
  if (files === undefined) {
    console.warn('[desk-editor] desk-files not mounted; viewer registration skipped')
  }

  // Register as the file domain's default viewer (id matches the editor view).
  if (files !== undefined) {
    ctx.effect(() => files.registerFileViewer({ id: 'editor', default: true }), 'desk-editor: file viewer')
  }

  // The editor-area view that receives open seeds ({ path, title }).
  ctx.effect(() => workbench.registerEditorView({
    id: 'editor',
    title: 'Editor',
    order: 100,
    component: EditorView,
  }), 'desk-editor: editor view')
}
