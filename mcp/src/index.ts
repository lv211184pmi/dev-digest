/**
 * stdio entrypoint for the DevDigest MCP server.
 *
 * !!! stdout is the JSON-RPC channel. NEVER `console.log` in this package —
 * !!! a single stray write corrupts the protocol stream. Diagnostics go to
 * !!! stderr via `console.error`, which the host shows in its MCP log.
 *
 * The host spawns this process; it is not a daemon and `scripts/dev.sh` does
 * not boot it. It does need the DevDigest API reachable at API_BASE — tools
 * report that themselves with an actionable message rather than failing here,
 * so the process still starts when the API is down.
 */

import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { API_BASE } from './config.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from './server.js';

const handle = serveStdio(() => createServer());

console.error(
  `[${SERVER_NAME}-mcp] v${SERVER_VERSION} ready on stdio — API base ${API_BASE}`,
);

let closing = false;

/**
 * `serveStdio` returns a handle with `close()`; without this the process can
 * outlive the host's disconnect and leave an orphan holding the pipe.
 */
function shutdown(signal: NodeJS.Signals): void {
  if (closing) return;
  closing = true;
  console.error(`[${SERVER_NAME}-mcp] ${signal} — shutting down`);
  void handle
    .close()
    .catch((err: unknown) => {
      console.error(`[${SERVER_NAME}-mcp] error while closing:`, err);
    })
    .finally(() => {
      process.exit(0);
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
