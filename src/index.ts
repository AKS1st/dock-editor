/**
 * Host half of dock-editor: the /desk-editor JSON API (text file read with a
 * size cap, binary NUL detection). Browser-trust fenced like the /api
 * gateway; conversation-scoped through the session cwd. Wire / fence /
 * fs helpers follow the same stripped pattern as dock-files.
 *
 * Reads accept any absolute path — the conversation context can mention
 * files outside the session workspace (e.g. ~/.dsh/skills/...), and the
 * workbench viewers open them for viewing. Writes stay workspace-confined
 * (fs.write 403s outside paths); a read response carries `writable:false`
 * for outside-workspace files so the editor opens them read-only.
 */
import { open, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'

export const name = 'dock-editor'

/** Services required before mounting. */
export const inject = ['webServer', 'sessions', 'webRuntime']

// ── Wire helpers (same envelope as the /wb-files API) ─────────────────────

type WbErrorCode = 'bad-request' | 'forbidden' | 'fs-error' | 'not-found' | 'internal'

export class WbError extends Error {
  constructor(
    readonly code: WbErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

const MAX_BODY_BYTES = 1 << 20

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new WbError('bad-request', 'request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new WbError('bad-request', 'request body is not valid JSON')
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function writeOk(res: ServerResponse, value: unknown): void {
  writeJson(res, 200, { ok: true, value })
}

function writeError(res: ServerResponse, error: unknown): void {
  if (error instanceof WbError) {
    writeJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  writeJson(res, 500, { ok: false, error: { code: 'internal', message } })
}

function stringOrUndefined(payload: unknown, key: string): string | undefined {
  const value = (payload as Record<string, unknown> | null)?.[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function requireAbsolute(path: string): string {
  if (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path)) {
    throw new WbError('fs-error', `"${path}" is not an absolute path`, 400)
  }
  return path
}

/**
 * Confine a caller-supplied absolute path to the session workspace: the
 * canonical (symlink-resolved) path must equal the canonical session cwd or
 * live under it (separator boundary). Any escape — `..`, a symlink pointing
 * out of the workspace, or an unrelated absolute path — is rejected 403.
 * For a not-yet-existing write target, the parent directory is canonicalized
 * and the basename re-appended before the containment check. Returns the
 * canonical target path.
 */
async function resolveWorkspacePath(cwd: string, raw: string): Promise<string> {
  const root = await realpath(cwd).catch(() => resolve(cwd))
  requireAbsolute(raw)
  let target: string
  try {
    target = await realpath(raw)
  } catch {
    const parent = await realpath(dirname(raw)).catch(() => dirname(raw))
    target = join(parent, basename(raw))
  }
  const rel = relative(root, target)
  if (rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) {
    return target
  }
  throw new WbError('forbidden', `path is outside the session workspace: "${raw}"`, 403)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Resolve a caller-supplied absolute path for READING: no workspace
 * containment — viewers open files anywhere on the host, because the
 * conversation context can mention paths outside the session workspace.
 * Writes stay confined (fs.write uses resolveWorkspacePath).
 */
function resolveReadPath(raw: string): string {
  requireAbsolute(raw)
  return resolve(raw)
}

/**
 * Whether a caller-supplied absolute path lies inside the session workspace
 * (canonical containment, same rule as resolveWorkspacePath). The read route
 * reports this as `writable` so the client opens outside-workspace files
 * read-only; fs.write independently rejects such paths (defense in depth).
 */
async function isInsideWorkspace(cwd: string, raw: string): Promise<boolean> {
  const root = await realpath(cwd).catch(() => resolve(cwd))
  requireAbsolute(raw)
  let target: string
  try {
    target = await realpath(raw)
  } catch {
    const parent = await realpath(dirname(raw)).catch(() => dirname(raw))
    target = join(parent, basename(raw))
  }
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** Cap for a single text-file read (256 KiB keeps the editor snappy). */
const READ_LIMIT_BYTES = 1 << 18

/** Text read of a file with a size cap; binary detection via NUL probe. */
async function readFileText(path: string, readLimit: number): Promise<{
  content: string
  truncated: boolean
  binary: boolean
  size: number
}> {
  const info = await stat(path).catch((error) => {
    throw new WbError('fs-error', `cannot read "${path}": ${messageOf(error)}`, 400)
  })
  if (info.isDirectory()) {
    throw new WbError('fs-error', `"${path}" is a directory`, 400)
  }
  const size = info.size
  const truncated = size > readLimit
  const handle = await open(path, 'r').catch((error) => {
    throw new WbError('fs-error', `cannot read "${path}": ${messageOf(error)}`, 400)
  })
  try {
    const buffer = Buffer.alloc(Math.min(size, readLimit))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const slice = buffer.subarray(0, bytesRead)
    const binary = slice.includes(0)
    return { content: binary ? '' : slice.toString('utf8'), truncated, binary, size }
  } finally {
    await handle.close()
  }
}

// ── Trust fence (same as dock-files) ──────────────────────────────────────

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function parseAuthority(authority: string): URL | undefined {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

function canonicalAuthority(entry: string, entryUrl: URL): string {
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

function isTrustedRequest(request: IncomingMessage, trustedHosts: readonly string[]): boolean {
  const host = header(request.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(request.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

// ── Plugin body ───────────────────────────────────────────────────────────

interface WbContext {
  webServer: {
    register(options: {
      kind: 'prefix'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
    }): () => void
  }
  sessions: {
    get(sessionId: string): { header: { cwd?: string } } | undefined
  }
  webRuntime: {
    trustedHosts: readonly string[]
  }
  effect(fn: () => void | (() => void), label?: string): void
}

function sessionCwdOf(ctx: WbContext, sessionId: string | undefined): string {
  if (sessionId !== undefined) {
    const cwd = ctx.sessions.get(sessionId)?.header.cwd
    if (cwd !== undefined && cwd !== '') return cwd
  }
  return process.cwd()
}

export function apply(ctx: WbContext): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/desk-editor',
    handler: async (req, res) => {
      if (!isTrustedRequest(req, ctx.webRuntime.trustedHosts)) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: { code: 'bad-request', message: 'method not allowed' } })
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const method = pathname.startsWith('/desk-editor/') ? pathname.slice('/desk-editor/'.length) : undefined
      if (method === undefined || method.includes('/')) {
        writeError(res, new WbError('not-found', `unknown /desk-editor method "${method}"`, 404))
        return
      }
      try {
        const payload = await readJsonBody(req)
        if (method === 'fs.read') {
          const sessionId = stringOrUndefined(payload, 'sessionId')
          const raw = stringOrUndefined(payload, 'path')
          if (raw === undefined) {
            writeError(res, new WbError('bad-request', 'fs.read requires a "path"', 400))
            return
          }
          const cwd = sessionCwdOf(ctx, sessionId)
          const path = resolveReadPath(raw)
          const file = await readFileText(path, READ_LIMIT_BYTES)
          // Outside-workspace files open read-only: saving stays confined to
          // the session workspace (fs.write), so tell the client up front.
          const writable = await isInsideWorkspace(cwd, path)
          writeOk(res, { file, cwd, writable })
          return
        }
        if (method === 'fs.write') {
          const raw = stringOrUndefined(payload, 'path')
          const text = stringOrUndefined(payload, 'content')
          if (raw === undefined || text === undefined) {
            writeError(res, new WbError('bad-request', 'fs.write requires "path" and "content"', 400))
            return
          }
          const cwd = sessionCwdOf(ctx, stringOrUndefined(payload, 'sessionId'))
          const path = await resolveWorkspacePath(cwd, raw)
          // Truncation guard: a file larger than the read cap can never be
          // fully read by this editor, so writing the partial buffer back
          // would silently destroy the rest of the file (C2). Reject the
          // write before touching the target.
          const info = await stat(path).catch(() => undefined)
          if (info !== undefined && info.size > READ_LIMIT_BYTES) {
            writeError(res, new WbError('fs-error',
              `"${raw}" is ${info.size} bytes, over the ${READ_LIMIT_BYTES}-byte editor limit`, 413))
            return
          }
          await writeFile(path, text, 'utf8').catch((error) => {
            throw new WbError('fs-error', `cannot write "${raw}": ${messageOf(error)}`, 400)
          })
          writeOk(res, { saved: true, cwd })
          return
        }
        writeError(res, new WbError('not-found', `unknown /desk-editor method "${method}"`, 404))
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'dock-editor: /desk-editor routes')
}
