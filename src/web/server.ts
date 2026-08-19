import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { DashboardAction } from "./actions";
import { renderPage } from "./page";
import { deriveSteps, type Snapshot } from "./steps";
import { gather } from "./snapshot";

export interface DashboardDeps {
  readers: Parameters<typeof gather>[0];
  meta: () => Record<string, string>;
  actions: (snapshot: Snapshot, dashboardStartedAt: number) => DashboardAction[];
  runAction: (action: DashboardAction, typedConfirmation: string) => Promise<{ output: string }>;
  port: number;
  log: (line: string) => void;
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res
    .writeHead(status, { "content-type": "application/json", "cache-control": "no-store" })
    .end(JSON.stringify(value));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req) {
    body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (body.length > 8_192) throw new Error("Request body is too large.");
  }
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function tokenMatches(expectedHex: string, candidate: unknown): boolean {
  if (typeof candidate !== "string" || !/^[0-9a-f]{64}$/.test(candidate)) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const supplied = Buffer.from(candidate, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

// Bound to loopback only. POST actions are a fixed allowlist, recomputed from a
// fresh snapshot, protected by same-origin + a per-process token, and still pass
// through each command's exact typed confirmation gate.
export function startDashboard(deps: DashboardDeps): { close: () => void } {
  const page = renderPage();
  const dashboardStartedAt = Date.now();
  const actionToken = randomBytes(32).toString("hex");
  const allowedOrigins = new Set([
    `http://127.0.0.1:${deps.port}`,
    `http://localhost:${deps.port}`,
  ]);
  let actionRunning = false;

  async function currentState() {
    const { snapshot, warnings } = await gather(deps.readers);
    return {
      snapshot,
      steps: deriveSteps(snapshot),
      meta: deps.meta(),
      warnings,
      actions: deps.actions(snapshot, dashboardStartedAt),
    };
  }

  const server = createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      res
        .writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
        .end(page);
      return;
    }

    if (req.method === "GET" && req.url === "/api/state") {
      void currentState()
        .then(({ snapshot: _snapshot, ...state }) => sendJson(res, 200, { ...state, actionToken }))
        .catch((error: unknown) =>
          sendJson(res, 500, { error: error instanceof Error ? error.message : "failed" }),
        );
      return;
    }

    if (req.method === "POST" && req.url === "/api/action") {
      const origin = req.headers.origin;
      const contentType = req.headers["content-type"] ?? "";
      if (!origin || !allowedOrigins.has(origin) || !contentType.startsWith("application/json")) {
        sendJson(res, 403, { error: "Rejected non-local action request." });
        return;
      }
      if (actionRunning) {
        sendJson(res, 409, { error: "Another action is already running." });
        return;
      }

      // Reserve before the first await. Otherwise two requests arriving during
      // the snapshot refresh could both observe `false` and start two commands.
      actionRunning = true;
      void (async () => {
        const body = await readJson(req);
        if (!tokenMatches(actionToken, body.token)) {
          sendJson(res, 403, { error: "Invalid action token." });
          return;
        }

        const id = typeof body.action === "string" ? body.action : "";
        const confirmation = typeof body.confirmation === "string" ? body.confirmation : "";
        const { snapshot } = await currentState();
        const action = deps.actions(snapshot, dashboardStartedAt).find((item) => item.id === id);
        if (!action) {
          sendJson(res, 409, { error: "That action is no longer available; refresh state." });
          return;
        }
        if (confirmation !== action.confirmation) {
          sendJson(res, 400, { error: "Confirmation phrase did not match; nothing was run." });
          return;
        }

        const result = await deps.runAction(action, confirmation);
        sendJson(res, 200, { ok: true, output: result.output });
      })().catch((error: unknown) => {
        sendJson(res, 500, { error: error instanceof Error ? error.message : "Action failed." });
      }).finally(() => {
        actionRunning = false;
      });
      return;
    }

    res.writeHead(404).end();
  });

  server.listen(deps.port, "127.0.0.1", () => {
    deps.log(`  dashboard: http://127.0.0.1:${deps.port}`);
    deps.log("  local actions require an exact typed confirmation");
  });

  return { close: () => server.close() };
}
