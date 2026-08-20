import { open, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
//#region src/index.ts
/**
* Host half of dock-editor: the /desk-editor JSON API (text file read with a
* size cap, binary NUL detection). Browser-trust fenced like the /api
* gateway; conversation-scoped through the session cwd. Wire / fence /
* fs helpers follow the same stripped pattern as dock-files.
*/
const name = "dock-editor";
/** Services required before mounting. */
const inject = [
	"webServer",
	"sessions",
	"webRuntime"
];
var WbError = class extends Error {
	code;
	status;
	constructor(code, message, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
	}
};
const MAX_BODY_BYTES = 1 << 20;
async function readJsonBody(req) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = Buffer.from(chunk);
		total += buffer.length;
		if (total > MAX_BODY_BYTES) throw new WbError("bad-request", "request body too large");
		chunks.push(buffer);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text.trim() === "") return {};
	try {
		return JSON.parse(text);
	} catch {
		throw new WbError("bad-request", "request body is not valid JSON");
	}
}
function writeJson(res, status, body) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}
function writeOk(res, value) {
	writeJson(res, 200, {
		ok: true,
		value
	});
}
function writeError(res, error) {
	if (error instanceof WbError) {
		writeJson(res, error.status, {
			ok: false,
			error: {
				code: error.code,
				message: error.message
			}
		});
		return;
	}
	writeJson(res, 500, {
		ok: false,
		error: {
			code: "internal",
			message: error instanceof Error ? error.message : String(error)
		}
	});
}
function stringOrUndefined(payload, key) {
	const value = payload?.[key];
	return typeof value === "string" && value !== "" ? value : void 0;
}
function requireAbsolute(path) {
	if (!path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path)) throw new WbError("fs-error", `"${path}" is not an absolute path`, 400);
	return path;
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
async function resolveWorkspacePath(cwd, raw) {
	const root = await realpath(cwd).catch(() => resolve(cwd));
	requireAbsolute(raw);
	let target;
	try {
		target = await realpath(raw);
	} catch {
		const parent = await realpath(dirname(raw)).catch(() => dirname(raw));
		target = join(parent, basename(raw));
	}
	const rel = relative(root, target);
	if (rel === "" || rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) return target;
	throw new WbError("forbidden", `path is outside the session workspace: "${raw}"`, 403);
}
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
/** Cap for a single text-file read (256 KiB keeps the editor snappy). */
const READ_LIMIT_BYTES = 1 << 18;
/** Text read of a file with a size cap; binary detection via NUL probe. */
async function readFileText(path, readLimit) {
	const info = await stat(path).catch((error) => {
		throw new WbError("fs-error", `cannot read "${path}": ${messageOf(error)}`, 400);
	});
	if (info.isDirectory()) throw new WbError("fs-error", `"${path}" is a directory`, 400);
	const size = info.size;
	const truncated = size > readLimit;
	const handle = await open(path, "r").catch((error) => {
		throw new WbError("fs-error", `cannot read "${path}": ${messageOf(error)}`, 400);
	});
	try {
		const buffer = Buffer.alloc(Math.min(size, readLimit));
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const slice = buffer.subarray(0, bytesRead);
		const binary = slice.includes(0);
		return {
			content: binary ? "" : slice.toString("utf8"),
			truncated,
			binary,
			size
		};
	} finally {
		await handle.close();
	}
}
function header(headers, name) {
	const value = headers[name];
	return typeof value === "string" ? value : void 0;
}
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
function parseAuthority(authority) {
	try {
		return new URL(`http://${authority}`);
	} catch {
		return;
	}
}
function canonicalAuthority(entry, entryUrl) {
	const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
	return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}
function isTrustedAuthority(hostUrl, trustedHosts) {
	return trustedHosts.some((entry) => {
		const entryUrl = parseAuthority(entry);
		if (entryUrl === void 0) return false;
		return canonicalAuthority(entry, entryUrl) === entryUrl.hostname ? entryUrl.hostname === hostUrl.hostname : entryUrl.host === hostUrl.host;
	});
}
function isTrustedRequest(request, trustedHosts) {
	const host = header(request.headers, "host");
	if (host === void 0) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === void 0) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
	if (header(request.headers, "sec-fetch-site") === "cross-site") return false;
	const origin = header(request.headers, "origin");
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
function sessionCwdOf(ctx, sessionId) {
	if (sessionId !== void 0) {
		const cwd = ctx.sessions.get(sessionId)?.header.cwd;
		if (cwd !== void 0 && cwd !== "") return cwd;
	}
	return process.cwd();
}
function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/desk-editor",
		handler: async (req, res) => {
			if (!isTrustedRequest(req, ctx.webRuntime.trustedHosts)) {
				writeJson(res, 403, {
					ok: false,
					error: {
						code: "forbidden",
						message: "forbidden"
					}
				});
				return;
			}
			if (req.method !== "POST") {
				writeJson(res, 405, {
					ok: false,
					error: {
						code: "bad-request",
						message: "method not allowed"
					}
				});
				return;
			}
			const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
			const method = pathname.startsWith("/desk-editor/") ? pathname.slice(13) : void 0;
			if (method === void 0 || method.includes("/")) {
				writeError(res, new WbError("not-found", `unknown /desk-editor method "${method}"`, 404));
				return;
			}
			try {
				const payload = await readJsonBody(req);
				if (method === "fs.read") {
					const sessionId = stringOrUndefined(payload, "sessionId");
					const raw = stringOrUndefined(payload, "path");
					if (raw === void 0) {
						writeError(res, new WbError("bad-request", "fs.read requires a \"path\"", 400));
						return;
					}
					const cwd = sessionCwdOf(ctx, sessionId);
					writeOk(res, {
						file: await readFileText(await resolveWorkspacePath(cwd, raw), READ_LIMIT_BYTES),
						cwd
					});
					return;
				}
				if (method === "fs.write") {
					const raw = stringOrUndefined(payload, "path");
					const text = stringOrUndefined(payload, "content");
					if (raw === void 0 || text === void 0) {
						writeError(res, new WbError("bad-request", "fs.write requires \"path\" and \"content\"", 400));
						return;
					}
					const cwd = sessionCwdOf(ctx, stringOrUndefined(payload, "sessionId"));
					const path = await resolveWorkspacePath(cwd, raw);
					const info = await stat(path).catch(() => void 0);
					if (info !== void 0 && info.size > READ_LIMIT_BYTES) {
						writeError(res, new WbError("fs-error", `"${raw}" is ${info.size} bytes, over the ${READ_LIMIT_BYTES}-byte editor limit`, 413));
						return;
					}
					await writeFile(path, text, "utf8").catch((error) => {
						throw new WbError("fs-error", `cannot write "${raw}": ${messageOf(error)}`, 400);
					});
					writeOk(res, {
						saved: true,
						cwd
					});
					return;
				}
				writeError(res, new WbError("not-found", `unknown /desk-editor method "${method}"`, 404));
			} catch (error) {
				writeError(res, error);
			}
		}
	}), "dock-editor: /desk-editor routes");
}
//#endregion
export { WbError, apply, inject, name };
