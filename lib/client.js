window.__ModuleLoader__.load({
	id: "dock-editor",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom_client = require("react-dom/client");
		//#region src/client/i18n.ts
		/** Complete dictionaries — every key below exists in BOTH locales. */
		const DICTS = {
			zh: {
				unsavedCloseConfirm: "有未保存的修改，确定关闭？",
				ok: "确定",
				cancel: "取消",
				save: "保存",
				saveDirty: "保存 ●",
				saving: "保存中…",
				savedAt: "已保存 {time}",
				saveTooLarge: "文件超过 256 KiB 编辑上限，已禁止保存，以免截断原文件。",
				truncatedNotice: "文件超过 256 KiB，仅显示前 256 KiB；已禁用保存以免截断原文件。"
			},
			en: {
				unsavedCloseConfirm: "You have unsaved changes. Close anyway?",
				ok: "OK",
				cancel: "Cancel",
				save: "Save",
				saveDirty: "Save ●",
				saving: "Saving…",
				savedAt: "Saved {time}",
				saveTooLarge: "File exceeds the 256 KiB editing limit; saving is disabled to avoid truncating the original file.",
				truncatedNotice: "File exceeds 256 KiB; only the first 256 KiB is shown, and saving is disabled to avoid truncating the original file."
			}
		};
		/**
		* Look up a dictionary key for a locale. Missing key → zh fallback → the key
		* itself (never blank). `{name}` placeholders are replaced from `params`.
		*/
		function translate(locale, key, params) {
			const template = DICTS[locale]?.[key] ?? DICTS.zh[key] ?? key;
			if (params === void 0) return template;
			return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
		}
		/**
		* Resolve the active locale: the DSH locale service
		* (`ctx.get('locale')?.getSnapshot?.()?.active`, 'zh' | 'en') wins; otherwise
		* the browser language (`navigator.language.startsWith('zh')`) decides, with
		* English as the last resort. `ctx` may be absent (standalone runs).
		*/
		function detectLocale(ctx) {
			const active = (ctx?.get?.("locale"))?.getSnapshot?.()?.active;
			if (active === "zh" || active === "en") return active;
			if (typeof navigator !== "undefined" && typeof navigator.language === "string" && navigator.language.toLowerCase().startsWith("zh")) return "zh";
			return "en";
		}
		//#endregion
		//#region src/client/hooks.ts
		/**
		* Shared client hooks for dock-editor: the locale subscription hook and the
		* translate-bound function type. i18n.ts stays pure (no React import) so it
		* can run standalone; the React glue lives here.
		*/
		/**
		* The active DSH locale, re-resolved on every 'locale/change' event (the
		* locale service publishes the snapshot the same way getSnapshot does).
		*/
		function useLocale(ctx) {
			const [locale, setLocale] = (0, react.useState)(() => detectLocale(ctx));
			(0, react.useEffect)(() => ctx.on("locale/change", () => setLocale(detectLocale(ctx))), [ctx]);
			return locale;
		}
		//#endregion
		//#region src/client/EditorView.tsx
		/**
		* Editor view: editable text editor for the file carried by the open seed.
		* - textarea editing with a manual undo/redo stack (Ctrl+Z / Ctrl+Y)
		* - Ctrl+S (and the toolbar button) saves through /desk-editor/fs.write
		* - toolbar (undo / redo / save) sits at the left of the title bar
		*/
		/** localStorage key remembering the floating-window geometry per file path. */
		const geometryKey = (path) => `dock-editor:geometry:${path}`;
		function readGeometry(path) {
			try {
				if (typeof localStorage === "undefined") return null;
				const raw = localStorage.getItem(geometryKey(path));
				if (raw === null) return null;
				const parsed = JSON.parse(raw);
				if (typeof parsed.x === "number" && typeof parsed.y === "number" && typeof parsed.width === "number" && typeof parsed.height === "number") return {
					x: parsed.x,
					y: parsed.y,
					width: parsed.width,
					height: parsed.height
				};
				return null;
			} catch {
				return null;
			}
		}
		function writeGeometry(path, geometry) {
			try {
				if (typeof localStorage === "undefined") return;
				localStorage.setItem(geometryKey(path), JSON.stringify(geometry));
			} catch {}
		}
		/** Undo/redo stack bound: snapshots of previous values. */
		const STACK_LIMIT = 100;
		const INLINE = {
			wrap: {
				padding: "12px 16px",
				height: "100%",
				boxSizing: "border-box",
				display: "flex",
				flexDirection: "column"
			},
			head: {
				display: "flex",
				alignItems: "center",
				gap: 4,
				paddingBottom: 8,
				borderBottom: "1px solid var(--dsw-alias-border-l2, #d8dbe0)",
				marginBottom: 10,
				fontSize: 12,
				color: "var(--dsw-alias-label-secondary, #656d76)"
			},
			btn: {
				border: "1px solid var(--dsw-alias-border-l2, #d8dbe0)",
				background: "transparent",
				color: "var(--dsw-alias-label-primary, #1f2328)",
				borderRadius: 5,
				padding: "2px 8px",
				cursor: "pointer",
				fontSize: 12,
				opacity: 1
			},
			btnDisabled: {
				opacity: .4,
				cursor: "default"
			},
			btnDirty: { background: "var(--dsw-alias-interactive-bg-hover-accent, rgba(90,120,255,0.18))" },
			title: {
				fontWeight: 600,
				color: "var(--dsw-alias-label-primary, #1f2328)",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
				marginLeft: 8,
				flex: 1
			},
			meta: { fontSize: 11 },
			area: {
				flex: 1,
				minHeight: 0,
				width: "100%",
				resize: "none",
				border: 0,
				outline: "none",
				background: "transparent",
				color: "var(--dsw-alias-label-primary, #1f2328)",
				fontSize: 13,
				lineHeight: 1.6,
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
				whiteSpace: "pre",
				overflow: "auto"
			},
			err: {
				color: "#d1242f",
				fontSize: 13
			},
			empty: {
				color: "var(--dsw-alias-label-secondary, #656d76)",
				fontSize: 13
			}
		};
		function EditorView(props) {
			const { ctx, sessionId, active, seed, viewId } = props;
			const openSeed = seed ?? {};
			const path = openSeed.path;
			const workbench = ctx.get("workbench");
			const locale = useLocale(ctx);
			const t = (0, react.useCallback)((key, params) => translate(locale, key, params), [locale]);
			const [content, setContent] = (0, react.useState)(null);
			const [binary, setBinary] = (0, react.useState)(false);
			const [truncated, setTruncated] = (0, react.useState)(false);
			const [size, setSize] = (0, react.useState)(0);
			const [error, setError] = (0, react.useState)(null);
			const [dirty, setDirty] = (0, react.useState)(false);
			const [saving, setSaving] = (0, react.useState)(false);
			const [savedAt, setSavedAt] = (0, react.useState)(null);
			const [canUndo, setCanUndo] = (0, react.useState)(false);
			const [canRedo, setCanRedo] = (0, react.useState)(false);
			const undoRef = (0, react.useRef)([]);
			const redoRef = (0, react.useRef)([]);
			const contentRef = (0, react.useRef)(null);
			const lastGeomRef = (0, react.useRef)(null);
			const lastDirtyRef = (0, react.useRef)(null);
			const syncStacks = () => {
				setCanUndo(undoRef.current.length > 0);
				setCanRedo(redoRef.current.length > 0);
			};
			/**
			* Resolve this view's own open instance id. The dock base hosts one
			* floating window per view (Phase F1) and hands views no instance id, so
			* the editor finds itself by matching its view id and seed path in the
			* current layout (floating window, else a legacy editor tab).
			*/
			const ownInstance = (0, react.useCallback)(() => {
				if (workbench === void 0 || path === void 0) return void 0;
				const layout = workbench.getLayout();
				const win = Object.values(layout.floatingWindows).find((w) => w.viewId === viewId && w.seed?.path === path);
				if (win !== void 0) return win.instanceId;
				return layout.editorTabs.find((t) => t.viewId === viewId && t.seed?.path === path)?.instanceId;
			}, [
				workbench,
				path,
				viewId
			]);
			(0, react.useEffect)(() => {
				if (path === void 0) return;
				let cancelled = false;
				lastDirtyRef.current = null;
				setContent(null);
				setError(null);
				setDirty(false);
				setTruncated(false);
				setSavedAt(null);
				undoRef.current = [];
				redoRef.current = [];
				syncStacks();
				(async () => {
					try {
						const json = await (await fetch("/desk-editor/fs.read", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({
								sessionId,
								path
							})
						})).json();
						if (json.ok !== true || json.value === void 0) throw new Error(json.error?.message ?? "read failed");
						if (cancelled) return;
						const file = json.value.file;
						contentRef.current = file.content;
						setContent(file.content);
						setBinary(file.binary);
						setTruncated(file.truncated);
						setSize(file.size);
					} catch (cause) {
						if (cancelled) return;
						setError(cause instanceof Error ? cause.message : String(cause));
					}
				})();
				return () => {
					cancelled = true;
				};
			}, [path, sessionId]);
			/**
			* Restore the remembered floating-window geometry for this file. The dock
			* base persists geometry per open instance (layout.floatingWindows), but a
			* closed window's geometry is discarded with it — so the editor re-applies
			* the last saved size/position per path on (re)open.
			*/
			(0, react.useEffect)(() => {
				lastGeomRef.current = null;
				if (path === void 0 || workbench === void 0) return;
				const saved = readGeometry(path);
				lastGeomRef.current = saved;
				if (saved === null) return;
				const instanceId = ownInstance();
				if (instanceId === void 0) return;
				workbench.moveFloatingWindow(instanceId, saved.x, saved.y);
				workbench.resizeFloatingWindow(instanceId, saved.x, saved.y, saved.width, saved.height);
			}, [
				path,
				workbench,
				ownInstance
			]);
			/**
			* Write geometry changes back to localStorage: dock notifies layout changes
			* while the user drags/resizes the floating window, so each change of this
			* file's window geometry is persisted under the path key.
			*/
			(0, react.useEffect)(() => {
				if (workbench === void 0 || path === void 0) return;
				const listener = () => {
					const instanceId = ownInstance();
					if (instanceId === void 0) return;
					const win = workbench.getLayout().floatingWindows[instanceId];
					if (win === void 0) return;
					const current = {
						x: win.x,
						y: win.y,
						width: win.width,
						height: win.height
					};
					const last = lastGeomRef.current;
					if (last === null) {
						lastGeomRef.current = current;
						return;
					}
					if (last.x === current.x && last.y === current.y && last.width === current.width && last.height === current.height) return;
					lastGeomRef.current = current;
					writeGeometry(path, current);
				};
				return workbench.onDidChangeLayout(listener);
			}, [
				path,
				workbench,
				ownInstance
			]);
			/**
			* Keep the instance seed's meta dirty flag in sync (updateViewSeed) so the
			* beforeClose hook registered on the view definition can confirm closing
			* the floating window with unsaved changes.
			*/
			(0, react.useEffect)(() => {
				if (workbench === void 0 || path === void 0) return;
				const instanceId = ownInstance();
				if (instanceId === void 0) return;
				if (lastDirtyRef.current === dirty) return;
				lastDirtyRef.current = dirty;
				workbench.updateViewSeed(instanceId, { meta: { dirty } });
			}, [
				dirty,
				path,
				workbench,
				ownInstance
			]);
			(0, react.useEffect)(() => {
				contentRef.current = content;
			}, [content]);
			/** Push the current value onto the undo stack, then apply the edit. */
			const edit = (0, react.useCallback)((next) => {
				const current = contentRef.current;
				if (current === null) return;
				undoRef.current.push(current);
				if (undoRef.current.length > STACK_LIMIT) undoRef.current.shift();
				redoRef.current = [];
				contentRef.current = next;
				setContent(next);
				setDirty(true);
				syncStacks();
			}, []);
			const undo = (0, react.useCallback)(() => {
				const prev = undoRef.current.pop();
				const current = contentRef.current;
				if (prev === void 0 || current === null) return;
				redoRef.current.push(current);
				contentRef.current = prev;
				setContent(prev);
				setDirty(true);
				syncStacks();
			}, []);
			const redo = (0, react.useCallback)(() => {
				const next = redoRef.current.pop();
				const current = contentRef.current;
				if (next === void 0 || current === null) return;
				undoRef.current.push(current);
				contentRef.current = next;
				setContent(next);
				setDirty(true);
				syncStacks();
			}, []);
			const save = (0, react.useCallback)(async () => {
				if (path === void 0 || contentRef.current === null || !dirty) return;
				if (truncated) {
					setError(t("saveTooLarge"));
					return;
				}
				setSaving(true);
				try {
					const json = await (await fetch("/desk-editor/fs.write", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							sessionId,
							path,
							content: contentRef.current
						})
					})).json();
					if (json.ok !== true) throw new Error(json.error?.message ?? "save failed");
					setDirty(false);
					setSavedAt(Date.now());
					setSize(new TextEncoder().encode(contentRef.current).length);
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setSaving(false);
				}
			}, [
				path,
				sessionId,
				dirty,
				truncated,
				t
			]);
			(0, react.useEffect)(() => {
				if (!active || path === void 0) return;
				const onKey = (event) => {
					if (!(event.ctrlKey || event.metaKey)) return;
					const key = event.key.toLowerCase();
					if (key === "s") {
						event.preventDefault();
						save();
					} else if (key === "z") {
						event.preventDefault();
						if (event.shiftKey) redo();
						else undo();
					} else if (key === "y") {
						event.preventDefault();
						redo();
					}
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [
				active,
				path,
				save,
				undo,
				redo
			]);
			const title = openSeed.title ?? path?.split("/").pop() ?? "No file";
			const btn = (label, action, disabled, extra) => (0, react.createElement)("button", {
				style: {
					...INLINE.btn,
					...disabled ? INLINE.btnDisabled : {},
					...extra ?? {}
				},
				disabled,
				onClick: action
			}, label);
			return (0, react.createElement)("div", { style: INLINE.wrap }, (0, react.createElement)("div", { style: INLINE.head }, btn("↶", undo, !canUndo), btn("↷", redo, !canRedo), btn(t(saving ? "saving" : dirty ? "saveDirty" : "save"), () => void save(), !dirty || saving || truncated, dirty ? INLINE.btnDirty : void 0), (0, react.createElement)("span", {
				style: INLINE.title,
				title: path
			}, title), savedAt !== null ? (0, react.createElement)("span", { style: INLINE.meta }, t("savedAt", { time: new Date(savedAt).toLocaleTimeString() })) : null), truncated ? (0, react.createElement)("div", { style: INLINE.err }, t("truncatedNotice")) : null, error !== null ? (0, react.createElement)("div", { style: INLINE.err }, error) : content === null ? (0, react.createElement)("div", { style: INLINE.empty }, "Reading…") : binary ? (0, react.createElement)("div", { style: INLINE.err }, "Binary file — editing is not supported.") : (0, react.createElement)("textarea", {
				style: INLINE.area,
				spellCheck: false,
				value: content,
				onChange: (event) => edit(event.target.value)
			}));
		}
		//#endregion
		//#region src/client/confirm.ts
		/**
		* Themed in-app confirm dialog for dock-editor, replacing the native
		* `window.confirm` (which clashes with the DSH UI). Mounts a small modal
		* into <body> through react-dom and resolves with the user's choice; uses
		* the same DSH theme tokens as the editor's inline styles.
		*/
		const BACKDROP = {
			position: "fixed",
			inset: 0,
			zIndex: 10001,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			background: "rgba(0, 0, 0, 0.35)"
		};
		const CARD = {
			minWidth: 260,
			maxWidth: 420,
			boxSizing: "border-box",
			padding: "14px 16px",
			borderRadius: 10,
			fontSize: 13,
			color: "var(--dsw-alias-label-primary, #1f2328)",
			background: "var(--dsw-alias-bg-layer-2, #ffffff)",
			border: "1px solid var(--dsw-alias-border-l2, #d8dbe0)",
			boxShadow: "0 12px 32px rgba(0, 0, 0, 0.25)"
		};
		const BODY = {
			lineHeight: 1.5,
			whiteSpace: "pre-wrap",
			wordBreak: "break-word"
		};
		const ACTIONS = {
			display: "flex",
			justifyContent: "flex-end",
			gap: 8,
			marginTop: 14
		};
		const BTN = {
			padding: "5px 14px",
			border: "1px solid var(--dsw-alias-border-l2, #d8dbe0)",
			borderRadius: 6,
			fontSize: 12,
			cursor: "pointer",
			color: "var(--dsw-alias-label-primary, #1f2328)",
			background: "var(--dsw-alias-bg-layer-2, #ffffff)"
		};
		const BTN_PRIMARY = {
			...BTN,
			borderColor: "transparent",
			color: "#ffffff",
			background: "#0969da"
		};
		function ConfirmDialog(props) {
			const { message, labels, onResult } = props;
			const okRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				okRef.current?.focus();
				const onKey = (event) => {
					if (event.key === "Escape") onResult(false);
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [onResult]);
			return (0, react.createElement)("div", {
				style: BACKDROP,
				onMouseDown: () => onResult(false)
			}, (0, react.createElement)("div", {
				style: CARD,
				onMouseDown: (event) => event.stopPropagation()
			}, (0, react.createElement)("div", { style: BODY }, message), (0, react.createElement)("div", { style: ACTIONS }, (0, react.createElement)("button", {
				style: BTN,
				onClick: () => onResult(false)
			}, labels?.cancel ?? "Cancel"), (0, react.createElement)("button", {
				ref: okRef,
				style: BTN_PRIMARY,
				onClick: () => onResult(true)
			}, labels?.ok ?? "OK"))));
		}
		/** Show a themed confirm; resolves true on 确定, false on 取消 / Esc / backdrop.
		*  `labels` carries already-translated button text (defaults 'OK' / 'Cancel'). */
		function confirmDialog(message, labels) {
			return new Promise((resolve) => {
				const host = document.createElement("div");
				document.body.appendChild(host);
				const root = (0, react_dom_client.createRoot)(host);
				const finish = (confirmed) => {
					root.unmount();
					host.remove();
					resolve(confirmed);
				};
				root.render((0, react.createElement)(ConfirmDialog, {
					message,
					labels,
					onResult: finish
				}));
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Requires the workbench base (carrier) and the dock-files file domain. */
		const inject = ["workbench", "files"];
		/**
		* The code glyph dock-editor registers for source/config file types: a
		* `</>` mark (thick stroke quads, single evenodd path in a 16×16 viewBox),
		* tinted per family through the icon color.
		*/
		const CODE_ICON = {
			viewBox: "0 0 16 16",
			path: "M4.42 8.40L6.72 5.40L5.68 4.60L3.38 7.60ZM3.38 8.40L5.68 11.40L6.72 10.60L4.42 7.60ZM6.58 5.41L8.48 11.01L9.72 10.59L7.82 4.99ZM12.99 7.57L10.39 4.57L9.41 5.43L12.01 8.43ZM12.01 7.57L9.41 10.57L10.39 11.43L12.99 8.43Z"
		};
		/**
		* Text/source families the editor opens, each with its explorer icon: the
		* `</>` code glyph tinted per family (colors mirror the dock-files built-in
		* palette, so the ownership moves here without changing the look).
		*/
		const CODE_FAMILIES = [
			{
				exts: [
					"ts",
					"tsx",
					"mts",
					"cts"
				],
				color: "#519aba"
			},
			{
				exts: [
					"js",
					"jsx",
					"mjs",
					"cjs"
				],
				color: "#d9a741"
			},
			{
				exts: ["json", "jsonc"],
				color: "#c9c64d"
			},
			{
				exts: [
					"yml",
					"yaml",
					"toml",
					"ini",
					"conf",
					"cfg"
				],
				color: "#d4633a"
			},
			{
				exts: [
					"css",
					"scss",
					"sass",
					"less"
				],
				color: "#42a5f5"
			},
			{
				exts: [
					"html",
					"htm",
					"xhtml",
					"xml"
				],
				color: "#e44d26"
			},
			{
				exts: ["py", "pyw"],
				color: "#3572a5"
			},
			{
				exts: [
					"sh",
					"bash",
					"zsh",
					"fish"
				],
				color: "#6ab04c"
			}
		];
		/** Client plugin body. */
		function apply(ctx) {
			const workbench = ctx.get("workbench");
			const files = ctx.get("files");
			if (workbench === void 0 || files === void 0) return;
			ctx.effect(() => files.registerFileViewer({
				id: "editor",
				default: true,
				icon: { color: "#8b949e" }
			}), "dock-editor: file viewer");
			for (const family of CODE_FAMILIES) ctx.effect(() => files.registerFileIcon({
				exts: family.exts,
				icon: {
					...CODE_ICON,
					color: family.color
				}
			}), `dock-editor: ${family.exts[0]} icons`);
			ctx.effect(() => workbench.registerEditorView({
				id: "editor",
				title: "Editor",
				order: 100,
				component: EditorView,
				beforeClose: (request) => {
					const meta = request.seed?.meta;
					if (meta !== null && typeof meta === "object" && meta.dirty === true) {
						const locale = detectLocale(ctx);
						return confirmDialog(translate(locale, "unsavedCloseConfirm"), {
							ok: translate(locale, "ok"),
							cancel: translate(locale, "cancel")
						});
					}
					return true;
				}
			}), "dock-editor: editor view");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map