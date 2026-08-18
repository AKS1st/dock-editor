/**
 * Client half of desk-editor: registers the 'editor' file viewer against the
 * desk-files file domain (as the default viewer) and the matching editor-area
 * view against desk. The view renders a file's text content (read-only in
 * Phase 1) fetched through its own /desk-editor/fs.read host route.
 *
 * inject declares BOTH 'workbench' and 'files': Cordis activates this plugin
 * only after desk (carrier) and desk-files (file domain) have provided their
 * services, so the viewer registration is never skipped by activation order.
 */
import type {} from 'desk/client/contract'
import type { WorkbenchContext, WorkbenchService } from 'desk/client/contract'
import { EditorView } from './EditorView'

/** Requires the workbench base (carrier) and the desk-files file domain. */
export const inject = ['workbench', 'files']

/** Local structural face of ctx.files (avoid type dependency on desk-files). */
interface FilesService {
  registerFileViewer(def: { id: string; exts?: string[]; default?: boolean }): () => void
}

/** Client plugin body. */
export function apply(ctx: WorkbenchContext): void {
  const workbench = ctx.get<WorkbenchService>('workbench')
  const files = ctx.get<FilesService>('files')
  // inject guarantees both services are present when this applies; guard
  // anyway so a broken runtime degrades instead of throwing.
  if (workbench === undefined || files === undefined) return

  // Register as the file domain's default viewer (id matches the editor view).
  ctx.effect(() => files.registerFileViewer({ id: 'editor', default: true }), 'desk-editor: file viewer')

  // The editor-area view that receives open seeds ({ path, title }).
  ctx.effect(() => workbench.registerEditorView({
    id: 'editor',
    title: 'Editor',
    order: 100,
    component: EditorView,
  }), 'desk-editor: editor view')
}
