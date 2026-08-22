/**
 * dock-editor code-source recognition: which file extensions get the
 * CodeMirror 6 editor (incremental syntax highlighting) and which language
 * each maps to.
 *
 * This is the single source of truth for "is this a code file" — the editor
 * view decides textarea vs. CodeMirror through `languageForPath`, and the
 * explorer icons are registered from the same extension families below. Keep
 * the two in bus: every extension that gets a language is also in a family.
 */
import type { Extension } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { python } from '@codemirror/lang-python'
import { StreamLanguage } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { xml } from '@codemirror/legacy-modes/mode/xml'
import { sCSS, less } from '@codemirror/legacy-modes/mode/css'

/**
 * Source/config family list, each with its explorer icon tint. Kept here so
 * icons (registered once against dock-files) and CodeMirror highlighting
 * (per-open-view) agree on what the editor owns. Colors mirror the dock-files
 * built-in palette.
 */
export const CODE_FAMILIES: { exts: string[]; color: string }[] = [
  { exts: ['ts', 'tsx', 'mts', 'cts'], color: '#519aba' },
  { exts: ['js', 'jsx', 'mjs', 'cjs'], color: '#d9a741' },
  { exts: ['json', 'jsonc'], color: '#c9c64d' },
  { exts: ['yml', 'yaml', 'toml', 'ini', 'conf', 'cfg'], color: '#d4633a' },
  { exts: ['css', 'scss', 'sass', 'less'], color: '#42a5f5' },
  { exts: ['html', 'htm', 'xhtml', 'xml'], color: '#e44d26' },
  { exts: ['py', 'pyw'], color: '#3572a5' },
  { exts: ['sh', 'bash', 'zsh', 'fish'], color: '#6ab04c' },
]

/** Member families flattened to a set of lowercase extension strings. */
export const CODE_EXTENSIONS: ReadonlySet<string> = new Set(
  CODE_FAMILIES.flatMap((family) => family.exts),
)

/** Lowercased extension (without the leading dot), or '' when none. */
function extOf(path: string): string {
  const base = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

/** Whether a file path is a code/config type this editor highlights. */
export function isCodePath(path: string): boolean {
  return CODE_EXTENSIONS.has(extOf(path))
}

/**
 * The CodeMirror 6 language extension for a path, or null when the file type
 * is not recognized (the caller then keeps the plain textarea). Language
 * selection is by extension, matching the icons above.
 */
export function languageForPath(path: string): Extension | null {
  const ext = extOf(path)
  switch (ext) {
    case 'ts':
    case 'mts':
    case 'cts':
      return javascript({ typescript: true, jsx: true })
    case 'tsx':
      return javascript({ typescript: true, jsx: true })
    case 'js':
    case 'mjs':
    case 'cjs':
      return javascript({ jsx: false })
    case 'jsx':
      return javascript({ jsx: true })
    case 'json':
    case 'jsonc':
      return json()
    case 'yml':
    case 'yaml':
      return yaml()
    case 'toml':
      return StreamLanguage.define(toml)
    case 'ini':
    case 'conf':
    case 'cfg':
      return StreamLanguage.define(properties)
    case 'css':
      return css()
    case 'scss':
    case 'sass':
      return StreamLanguage.define(sCSS)
    case 'less':
      return StreamLanguage.define(less)
    case 'html':
    case 'htm':
      return html()
    case 'xhtml':
    case 'xml':
      return StreamLanguage.define(xml)
    case 'py':
    case 'pyw':
      return python()
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'fish':
      return StreamLanguage.define(shell)
    default:
      return null
  }
}
