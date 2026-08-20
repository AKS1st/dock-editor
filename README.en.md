# dock-editor

[中文](README.md)

Text viewer/editor plugin of the dock family: registers the `editor` file viewer (the default one) and the matching editor-area view; reads and writes file text through its own `/desk-editor` host route.

## Features

- **Text viewing and editing**: textarea editing with a manual undo/redo stack (Ctrl+Z / Ctrl+Y) and Ctrl+S save.
- **Unsaved-change confirmation**: closing a window with unsaved edits asks for confirmation (via the workbench `beforeClose` hook and the seed dirty flag).
- **Binary detection**: NUL-byte probe on read; binary files show a notice instead of garbage.
- **Size cap**: single-file reads are capped at 256 KiB; larger files show only the first 256 KiB and **disable saving** so the original is never truncated (the host enforces the same check).
- **Floating-window geometry memory**: each file remembers its last floating-window position/size and restores it on reopen.

## Install

Requires `dock` and `dock-files`:

```sh
dsh plugin add github:AKS1st/dock
dsh plugin add github:AKS1st/dock-files
dsh plugin add github:AKS1st/dock-editor
```

## Security

The `/desk-editor` route only accepts POSTs from trusted origins (loopback / trustedHosts plus same-origin check). All read/write paths are canonicalized with realpath and confined to the session workspace (403 otherwise); writes also verify the target size does not exceed the read cap.

## License

MIT
