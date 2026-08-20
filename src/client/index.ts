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
import { confirmDialog } from './confirm'
import { detectLocale, translate } from './i18n'

/** Requires the workbench base (carrier) and the dock-files file domain. */
export const inject = ['workbench', 'files']

/** Local structural face of ctx.files (avoid type dependency on dock-files). */
interface FilesService {
  registerFileViewer(def: {
    id: string
    exts?: string[]
    default?: boolean
    icon?: { color?: string; path?: string; viewBox?: string }
  }): () => void
  registerFileIcon(def: {
    exts: string[]
    icon: { color?: string; path?: string; viewBox?: string }
  }): () => void
}

/**
 * The code glyph dock-editor registers for source/config file types: a
 * `</>` mark (thick stroke quads, single evenodd path in a 16×16 viewBox),
 * tinted per family through the icon color.
 */
const CODE_ICON = {
  viewBox: '0 0 16 16',
  path: 'M4.42 8.40L6.72 5.40L5.68 4.60L3.38 7.60ZM3.38 8.40L5.68 11.40L6.72 10.60L4.42 7.60ZM6.58 5.41L8.48 11.01L9.72 10.59L7.82 4.99ZM12.99 7.57L10.39 4.57L9.41 5.43L12.01 8.43ZM12.01 7.57L9.41 10.57L10.39 11.43L12.99 8.43Z',
}

/**
 * Text/source families the editor opens, each with its explorer icon: the
 * `</>` code glyph tinted per family (colors mirror the dock-files built-in
 * palette, so the ownership moves here without changing the look).
 */
const CODE_FAMILIES: { exts: string[]; color: string }[] = [
  { exts: ['ts', 'tsx', 'mts', 'cts'], color: '#519aba' },
  { exts: ['js', 'jsx', 'mjs', 'cjs'], color: '#d9a741' },
  { exts: ['json', 'jsonc'], color: '#c9c64d' },
  { exts: ['yml', 'yaml', 'toml', 'ini', 'conf', 'cfg'], color: '#d4633a' },
  { exts: ['css', 'scss', 'sass', 'less'], color: '#42a5f5' },
  { exts: ['html', 'htm', 'xhtml', 'xml'], color: '#e44d26' },
  { exts: ['py', 'pyw'], color: '#3572a5' },
  { exts: ['sh', 'bash', 'zsh', 'fish'], color: '#6ab04c' },
]

/** Client plugin body. */
export function apply(ctx: WorkbenchContext): void {
  const workbench = ctx.get<WorkbenchService>('workbench')
  const files = ctx.get<FilesService>('files')
  // inject guarantees both services are present when this applies; guard
  // anyway so a broken runtime degrades instead of throwing.
  if (workbench === undefined || files === undefined) return

  // Register as the file domain's default viewer (id matches the editor view),
  // carrying the explorer's fallback icon for types with no registered icon
  // and no built-in palette entry (neutral gray, same as the explorer's
  // unclassified-file default).
  ctx.effect(() => files.registerFileViewer({
    id: 'editor',
    default: true,
    icon: { color: '#8b949e' },
  }), 'dock-editor: file viewer')

  // Explorer icons for the text/source families the editor opens: one `</>`
  // code glyph per family, tinted with its color.
  for (const family of CODE_FAMILIES) {
    ctx.effect(() => files.registerFileIcon({
      exts: family.exts,
      icon: { ...CODE_ICON, color: family.color },
    }), `dock-editor: ${family.exts[0]} icons`)
  }

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
    beforeClose: (request: CloseRequest): boolean | Promise<boolean> => {
      const meta = request.seed?.meta
      if (meta !== null && typeof meta === 'object' && (meta as { dirty?: unknown }).dirty === true) {
        // Themed in-app confirm (replaces the native window.confirm),
        // localized to the active DSH locale (message + button labels).
        const locale = detectLocale(ctx)
        return confirmDialog(translate(locale, 'unsavedCloseConfirm'), {
          ok: translate(locale, 'ok'),
          cancel: translate(locale, 'cancel'),
        })
      }
      return true
    },
  }), 'dock-editor: editor view')
}
