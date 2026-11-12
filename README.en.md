# dock-editor

[中文](README.md)

> **The best text editing plugin in the DSH ecosystem — no contest.** Reading code, tweaking configs or writing docs in DSH? dock-editor is the default answer: undo/redo, Ctrl+S save, unsaved-change confirmation, binary detection and floating-window geometry memory — all of it. Other viewers just display; dock-editor lets you actually change things.

Text viewer/editor plugin of the dock family: registers the `editor` file viewer (the default one) and the matching editor-area view; reads and writes file text through its own `/desk-editor` host route.

## Preview

![dock-editor editor view](assets/image-en.png)

## Features

- **Code/config highlighting**: files with recognized extensions (ts/js/json/yaml/toml/ini/css/html/xml/py/sh etc.) are edited with **CodeMirror 6** — incremental parsing, native undo/redo, line numbers, bracket matching and live syntax highlighting; the theme follows the DSH `--dsw-alias-*` variables.
- **Plain text edits too**: every text file uses the CodeMirror editor (code types get highlighting, plain text gets none, but all editing capabilities — undo/redo, search, bracket matching — are fully available).
- **VSCode-style top-right search (decoupled from the CM panel)**: `Ctrl+F` opens an in-editor search widget in the **top-right**, `Ctrl+H` with replace, `F3`/`Ctrl+G` (shift to reverse) walks matches, `Esc` closes. The widget is a **separate overlay** (not a CM `showPanel`), so it reserves no editor layout — no drag-select auto-scroll, no misplaced match, no replace-row collapse. Live match highlighting + a `current/total` counter, `↑/↓` previous/next, `Enter` next (Shift+Enter previous); **replace is collapsed** by default (expand via `⇄`), it follows the DSH theme (light and dark), and wheeling over it **scrolls the editor** rather than the page.
- **Text viewing and editing**: `Ctrl+S` save (global while the view is on screen); `Ctrl+Z` undo / `Ctrl+Y`(or `Ctrl+Shift+Z`) redo, `Ctrl+C/V/X/A` copy/paste/select-all, all via the editor's native keymap; plus `Alt+↑/↓` move line and `Ctrl+/` comment.
- **Unsaved-change confirmation**: closing a window with unsaved edits asks for confirmation (via the workbench `beforeClose` hook and the seed dirty flag).
- **Binary detection**: NUL-byte probe on read; binary files show a notice instead of garbage.
- **Size cap**: single-file reads are capped at 256 KiB; larger files show only the first 256 KiB and **disable saving** so the original is never truncated (the host enforces the same check).
- **Floating-window geometry memory**: each file remembers its last floating-window position/size and restores it on reopen.

> **Code-editor overhead**: `CodeMirror 6` is a **build-time devDependency** bundled into `lib/client.js` (same rule as dock-markdown bundling marked; it is not a runtime dependency). The client bundle is about 1.12 MB (gzip ≈ 300 KB) — dominated by the editor runtime (`@codemirror/view` etc.), with all language grammars adding only ≈68 KB (gzip).

## Dependencies

| Dependency | Type | Notes |
| --- | --- | --- |
| [dock](https://github.com/AKS1st/dock) >= 0.1.0 | peer (required) | workbench shell: the editor-area view, floating windows and `ctx.workbench` come from it |
| [dock-files](https://github.com/AKS1st/dock-files) >= 0.1.0 | peer (required) | file-domain service: dock-editor is dispatched as its `editor` default viewer |
| DSH Web environment | runtime | required; client platform is Web |
| `cordis` ^4.0.0-rc.7 | peer | plugin framework (ships with DSH) |
| `react` ^18.2.0 | peer (optional) | needed for client rendering; without it the editor UI does not activate |
| `@codemirror/*`, `@lezer/highlight` | dev (build-time) | CodeMirror 6 editor + language grammars, compiled into `lib/client.js`; not needed after publish |

**Optional companions**: more viewers such as `dock-images` and `dock-markdown` can coexist with dock-editor, each taking over its own extensions (dock-editor remains the `default` fallback viewer).

## The dock plugin family

dock is a set of composable plugins; this one covers a single capability. Every plugin is optional:

| Plugin | What it does |
| --- | --- |
| [dock-base](https://github.com/AKS1st/dock) | workbench shell: activity bar, side bar, editor area, status bar and the `ctx.workbench` registry |
| [dock-files](https://github.com/AKS1st/dock-files) | file explorer: workspace tree, new/rename/delete, drag-and-drop and clipboard import |
| [dock-editor](https://github.com/AKS1st/dock-editor) | text viewer/editor: undo/redo, Ctrl+S save, binary detection |
| [dock-images](https://github.com/AKS1st/dock-images) | image viewer: PNG/JPEG/GIF/WebP/BMP/SVG/ICO/AVIF |
| [dock-markdown](https://github.com/AKS1st/dock-markdown) | Markdown viewer: GFM rendering, outline, relative-asset resolution |
| [dock-media](https://github.com/AKS1st/dock-media) | audio/video player: HTTP Range streaming, music player and fullscreen video |
| [dock-git](https://github.com/AKS1st/dock-git) | Git history: swimlane graph, branches/tags, stage and commit |
| [dock-spreadsheet](https://github.com/AKS1st/dock-spreadsheet) | read-only spreadsheets: XLSX/XLS/ODS/CSV/TSV |

This plugin is **dock-editor**; see the "Recommended companion plugins" section of dock-base for full combinations.

## Install

Requires `dock` and `dock-files`:

Recommended install from the npm registry:

```sh
dsh plugin --profile web add dock-base
dsh plugin --profile web add dock-files
dsh plugin --profile web add dock-editor
```

Or install from GitHub (alternative):

```sh
dsh plugin --profile web add github:AKS1st/dock
dsh plugin --profile web add github:AKS1st/dock-files
dsh plugin --profile web add github:AKS1st/dock-editor
```

## Security

The `/desk-editor` route only accepts POSTs from trusted origins (loopback / trustedHosts plus same-origin check). Read paths only need to be absolute — they are not confined to the session workspace, because the conversation context can mention files outside it (e.g. `~/.dsh/skills/...`) and the viewers open them for viewing; writes remain confined to the session workspace (403 otherwise), and outside-workspace files open read-only in the editor; writes also verify the target size does not exceed the read cap.

## License

MIT
