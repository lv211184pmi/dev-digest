/**
 * The one place this server talks to the DevDigest Fastify API.
 *
 * There is no auth (the API runs `LocalNoAuthProvider`) and no route prefix, so
 * this is a thin `fetch` wrapper whose real job is turning transport failures
 * into catalogued `ToolError`s — see `../domain/errors.ts` for why every message
 * has to lead forward.
 *
 * SECURITY: on a non-2xx we read the `ApiErrorBody` envelope and echo at most
 * ERROR_MAX characters of its `message`. The envelope's free-form diagnostic
 * payload is never read — it can carry raw provider output.
 */

import { ApiErrorBody } from '@devdigest/shared';
import { API_BASE, ERROR_MAX } from '../config.js';
import { ToolError, toolError, truncate, withStatus } from '../domain/errors.js';

export interface RequestOptions {
  /** Defaults to POST when a body is present, GET otherwise. */
  method?: 'GET' | 'POST';
  /** JSON-serialized; presence is what sets the content-type header. */
  body?: unknown;
  /** Host cancellation — passed straight through to `fetch`. */
  signal?: AbortSignal;
  /**
   * Per-route status mapping, consulted before the generic `api_error` fallback.
   * `message` is the already-truncated envelope message, or undefined when the
   * body was not a recognizable envelope.
   */
  mapStatus?: (status: number, message: string | undefined) => ToolError | undefined;
}

/** A host-initiated cancellation must stay an abort, not become "API is down". */
function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
}

/**
 * Reads the error envelope defensively: a non-JSON or off-contract error body is
 * simply "no message", never a parse failure of its own.
 */
async function readErrorMessage(res: Response): Promise<string | undefined> {
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return undefined;
  }
  const parsed = ApiErrorBody.safeParse(raw);
  return parsed.success ? truncate(parsed.data.error.message, ERROR_MAX) : undefined;
}

/**
 * Performs one API call and returns the decoded JSON body as `unknown`-shaped
 * `T`. Callers in `endpoints.ts` are responsible for validating that shape — a
 * cast here would only move the lie downstream.
 */
export async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const hasBody = init.body !== undefined;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? (hasBody ? 'POST' : 'GET'),
      // Only declare a JSON body when one is actually sent — a body-less POST
      // with a json content-type trips Fastify's "Body cannot be empty".
      ...(hasBody ? { headers: { 'content-type': 'application/json' } } : {}),
      ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
    });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw toolError('api_unreachable', API_BASE);
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    // Tag with the status either way, so a tool can branch on a specific code
    // (the skill-draft 409) without matching on message text.
    throw withStatus(
      init.mapStatus?.(res.status, message) ?? toolError('api_error', res.status, path, message),
      res.status,
    );
  }

  if (res.status === 204) return undefined as T;

  try {
    return (await res.json()) as T;
  } catch {
    throw toolError('contract_mismatch', 'JSON body', `${path} did not return valid JSON`);
  }
}
