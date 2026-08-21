/**
 * dock-editor client i18n: a tiny, dependency-free dictionary module (zh / en)
 * plus a `detectLocale` helper that reads the DSH locale service
 * (`ctx.get('locale').getSnapshot().active`, backed by settings.yaml
 * locale.preference with the browser language as fallback).
 *
 * The module is deliberately pure — no runtime imports, no DOM, no React — so
 * it runs standalone (scripts/smoke-i18n.mjs). The view layer combines it
 * with the DSH `locale/change` event (ctx.on) to re-render on a system
 * locale switch.
 *
 * Lookup order per key: DICTS[locale][key] → DICTS.zh[key] → the key itself
 * (missing text stays visible rather than blank).
 */

export type LocaleId = 'zh' | 'en'

export interface Dict {
  [key: string]: string
}

/** Complete dictionaries — every key below exists in BOTH locales. */
export const DICTS: Record<LocaleId, Dict> = {
  zh: {
    // ── Confirm dialog (beforeClose unsaved-changes gate) ────────────────
    unsavedCloseConfirm: '有未保存的修改，确定关闭？',
    ok: '确定',
    cancel: '取消',

    // ── Editor toolbar / status ──────────────────────────────────────────
    save: '保存',
    saveDirty: '保存 ●',
    saving: '保存中…',
    savedAt: '已保存 {time}',
    readOnly: '只读（工作区外）',

    // ── Size-limit guards (user-facing errors) ───────────────────────────
    saveTooLarge: '文件超过 256 KiB 编辑上限，已禁止保存，以免截断原文件。',
    truncatedNotice: '文件超过 256 KiB，仅显示前 256 KiB；已禁用保存以免截断原文件。',
  },
  en: {
    // ── Confirm dialog (beforeClose unsaved-changes gate) ────────────────
    unsavedCloseConfirm: 'You have unsaved changes. Close anyway?',
    ok: 'OK',
    cancel: 'Cancel',

    // ── Editor toolbar / status ──────────────────────────────────────────
    save: 'Save',
    saveDirty: 'Save ●',
    saving: 'Saving…',
    savedAt: 'Saved {time}',
    readOnly: 'Read-only (outside workspace)',

    // ── Size-limit guards (user-facing errors) ───────────────────────────
    saveTooLarge: 'File exceeds the 256 KiB editing limit; saving is disabled to avoid truncating the original file.',
    truncatedNotice: 'File exceeds 256 KiB; only the first 256 KiB is shown, and saving is disabled to avoid truncating the original file.',
  },
}

/**
 * Look up a dictionary key for a locale. Missing key → zh fallback → the key
 * itself (never blank). `{name}` placeholders are replaced from `params`.
 */
export function translate(locale: LocaleId, key: string, params?: Record<string, string | number>): string {
  const template = DICTS[locale]?.[key] ?? DICTS.zh[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    (name in params ? String(params[name]) : match))
}

/**
 * Resolve the active locale: the DSH locale service
 * (`ctx.get('locale')?.getSnapshot?.()?.active`, 'zh' | 'en') wins; otherwise
 * the browser language (`navigator.language.startsWith('zh')`) decides, with
 * English as the last resort. `ctx` may be absent (standalone runs).
 */
export function detectLocale(ctx: unknown): LocaleId {
  const locale = (ctx as { get?: (name: string) => unknown } | null | undefined)?.get?.('locale') as
    | { getSnapshot?: () => { active?: unknown } }
    | undefined
  const active = locale?.getSnapshot?.()?.active
  if (active === 'zh' || active === 'en') return active
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string' && navigator.language.toLowerCase().startsWith('zh')) {
    return 'zh'
  }
  return 'en'
}
