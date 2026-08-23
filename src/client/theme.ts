/**
 * CodeMirror 6 chrome + syntax theme for the dock editor.
 *
 * The editor background stays transparent (the dock floating-window chrome
 * shows through) and the foreground/selection/gutter map to the same
 * `--dsw-alias-*` variables the plain textarea uses, so the CodeMirror path
 * looks identical to the textarea path inside the same themed shell.
 *
 * Syntax token colors use a fixed, self-consistent palette (One-Dark inspired
 * mid-tones) that keeps readable contrast whether the DSH theme is light or
 * dark; the chrome itself (font, line-height, selection, caret, active line,
 * gutter) always follows the shell's variables.
 */
import { EditorView } from '@codemirror/view'
import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/** Editor chrome: transparent background, themed foreground, mono font. */
export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    position: 'relative',
    backgroundColor: 'transparent',
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    fontSize: '13px',
  },
  '.cm-scroller': {
    fontFamily: MONO,
    lineHeight: '1.6',
    overflow: 'auto',
  },
  '.cm-content': {
    caretColor: 'var(--dsw-alias-label-primary, #1f2328)',
    padding: '12px 16px',
  },
  '.cm-line': {
    whiteSpace: 'pre',
  },
  // CodeMirror adds `.cm-lineWrapping` (via EditorView.lineWrapping) to the
  // content when line wrapping is on; without this the explicit `whiteSpace:
  // pre` above would override the inherited wrap and force horizontal scroll.
  '.cm-content.cm-lineWrapping .cm-line': {
    whiteSpace: 'break-spaces',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--dsw-alias-label-primary, #1f2328)',
    borderLeftWidth: '2px',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(90, 120, 255, 0.18)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(90, 120, 255, 0.06)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(90, 120, 255, 0.08)',
    color: 'var(--dsw-alias-label-primary, #1f2328)',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--dsw-alias-label-secondary, #656d76)',
    border: 'none',
    fontFamily: MONO,
    fontSize: '12px',
    paddingRight: '6px',
  },
  '.cm-foldGutter': {
    color: 'var(--dsw-alias-label-secondary, #656d76)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--dsw-alias-bg-layer-2, #ffffff)',
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    border: '1px solid var(--dsw-alias-border-l2, #d8dbe0)',
  },
  // VSCode-style search panel: float it top-right, theme it, collapse the
  // replace row behind the injected toggle (.dsh-search-replace-open).
  '.cm-panels': {
    position: 'absolute',
    top: '6px',
    right: '10px',
    left: 'auto',
    border: 'none',
    background: 'transparent',
    zIndex: 20,
    // The container is full-size but invisible; only the visible panel box is
    // interactive, so clicks/wheel in the area under it pass through to the
    // editor instead of being swallowed by the container.
    pointerEvents: 'none',
  },
  '.cm-panel.cm-search': {
    position: 'relative',
    pointerEvents: 'auto',
    backgroundColor: 'var(--dsw-alias-bg-layer-2, #ffffff)',
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    border: '1px solid var(--dsw-alias-border-l2, #d8dbe0)',
    borderRadius: '6px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.14)',
    padding: '8px 8px 8px 32px',
    fontSize: '13px',
    maxWidth: '360px',
  },
  '.cm-panel.cm-search label': { display: 'none' },
  '.cm-panel.cm-search button[name="select"]': { display: 'none' },
  // Replace row collapsed by default; expands when the toggle adds the class.
  '.cm-panel.cm-search .cm-textfield[name="replace"], .cm-panel.cm-search button[name="replace"], .cm-panel.cm-search button[name="replaceAll"]': { display: 'none' },
  '.cm-panel.cm-search.dsh-search-replace-open .cm-textfield[name="replace"], .cm-panel.cm-search.dsh-search-replace-open button[name="replace"], .cm-panel.cm-search.dsh-search-replace-open button[name="replaceAll"]': { display: 'inline-block' },
  // The toggle is absolutely positioned in the panel's left gutter so it does
  // not shift the find input — keeping the find and replace fields aligned.
  '.cm-panel.cm-search [data-dsh-replace-toggle]': {
    position: 'absolute',
    left: '6px',
    top: '8px',
    border: 'none',
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary, #656d76)',
    cursor: 'pointer',
    padding: '2px 4px',
    fontSize: '14px',
    lineHeight: 1,
  },
  '.cm-panel.cm-search [data-dsh-replace-toggle]:hover': {
    background: 'var(--dsw-alias-interactive-bg-hover-accent, rgba(90,120,255,0.18))',
    borderRadius: '4px',
  },
  // Explicitly clear the CodeMirror base chrome (light/dark gradient buttons,
  // white textfields) so the panel follows the DSH theme. The editor theme is
  // treated as light by default, which in a dark shell produced a white input
  // with light text — so every interactive control is set to themed colors.
  '.cm-panel.cm-search button': {
    backgroundImage: 'none',
    backgroundColor: 'transparent',
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    border: '1px solid var(--dsw-alias-border-l2, #d8dbe0)',
    borderRadius: '4px',
    padding: '2px 8px',
    cursor: 'pointer',
    fontSize: '13px',
    height: '24px',
    boxSizing: 'border-box',
  },
  '.cm-panel.cm-search button:hover, .cm-panel.cm-search button:focus': {
    backgroundColor: 'var(--dsw-alias-interactive-bg-hover-accent, rgba(90,120,255,0.18))',
    outline: 'none',
  },
  '.cm-panel.cm-search button:active': {
    backgroundColor: 'var(--dsw-alias-interactive-bg-active, rgba(90,120,255,0.28))',
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search .cm-textfield': {
    backgroundImage: 'none',
    backgroundColor: 'transparent',
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    caretColor: 'var(--dsw-alias-label-primary, #1f2328)',
    border: '1px solid var(--dsw-alias-border-l2, #d8dbe0)',
    borderRadius: '4px',
    padding: '2px 6px',
    fontFamily: MONO,
    fontSize: '13px',
    height: '24px',
    boxSizing: 'border-box',
    width: '200px',
  },
  '.cm-panel.cm-search .cm-textfield[name="replace"]': {
    // Keep the replace field the same width as the find field so the rows align.
    width: '200px',
  },
  '.cm-panel.cm-search input::placeholder': {
    color: 'var(--dsw-alias-label-tertiary, #8b949e)',
  },
})

/** Syntax token colors (One-Dark-inspired mid-tones, readable on light/dark). */
export const editorHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#c678dd' },
  { tag: [t.operator, t.operatorKeyword], color: '#56b6c2' },
  { tag: [t.string, t.special(t.string)], color: '#98c379' },
  { tag: [t.number, t.bool, t.null], color: '#d19a66' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#61afef' },
  { tag: [t.definition(t.variableName), t.propertyName, t.attributeName], color: '#e06c75' },
  { tag: [t.className, t.typeName, t.namespace], color: '#e5c07b' },
  { tag: t.comment, color: '#7f848e', fontStyle: 'italic' },
  { tag: t.regexp, color: '#56b6c2' },
  { tag: t.meta, color: '#7f848e' },
  { tag: [t.tagName, t.name], color: '#e06c75' },
  { tag: t.angleBracket, color: '#7f848e' },
  { tag: t.punctuation, color: 'var(--dsw-alias-label-primary, #1f2328)' },
])
