/**
 * Client half of dock-editor: registers the 'editor' file viewer against the
 * dock-files file domain (as the default viewer) and the matching editor-area
 * view against dock. The view renders a file's text content fetched through
 * its own /desk-editor/fs.read host route.
 *
 * inject declares BOTH 'workbench' and 'files': Cordis activates this plugin
 * only after dock (carrier) and dock-files (file domain) have provided their
 * services, so the viewer registration is never skipped by activation order.
 */
import type {} from './contract.ts'
import type { CloseRequest, WorkbenchContext, WorkbenchService } from './contract.ts'
import { EditorView } from './EditorView'

/** Requires the workbench base (carrier) and the dock-files file domain. */
export const inject = ['workbench', 'files']

/** Local structural face of ctx.files (avoid type dependency on dock-files). */
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
  ctx.effect(() => files.registerFileViewer({ id: 'editor', default: true }), 'dock-editor: file viewer')

  // The view that receives open seeds ({ path, title }). It stays registered
  // as an editor-area view because floating windows resolve their view
  // through this registry; opening itself is always floating (dock-files
  // dispatches { mode: 'floating' }), so no tab-open path remains. The
  // beforeClose hook consumes the dirty flag the view syncs onto seed.meta
  // (updateViewSeed) and confirms closing the window with unsaved edits.
  ctx.effect(() => workbench.registerEditorView({
    id: 'editor',
    title: 'Editor',
    order: 100,
    component: EditorView,
    beforeClose: (request: CloseRequest) => {
      const meta = request.seed?.meta
      if (meta !== null && typeof meta === 'object' && (meta as { dirty?: unknown }).dirty === true) {
        return window.confirm('有未保存的修改，确定关闭？')
      }
      return true
    },
  }), 'dock-editor: editor view')
}
