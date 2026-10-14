import http from "node:http";
import { readFile, writeFile, open } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { StudioWorkspace } from "./workspace.mjs";
import { requireValue as check, fileHash } from "../common.mjs";
import * as assistant from "./assistant.mjs";
import { modelRuntime, assetMime } from "./model-runtime.mjs";
import { reviewPlan } from "./review-plan.mjs";

const ui = resolve(dirname(fileURLToPath(import.meta.url)), "ui");
const secret = () => randomBytes(32).toString("hex");
export const passwordHash = (password, salt) =>
  scryptSync(password, salt, 64).toString("hex");
export async function createStudio(root, { port = 0 } = {}) {
  const workspace = await new StudioWorkspace(root).init();
  const runtime = await modelRuntime();
  const sessions = new Map(),
    failures = new Map();
  let cached,
    cacheAt = 0,
    catalogEpoch = 0,
    pendingCatalog;
  const invalidateCatalog = () => {
    catalogEpoch++;
    cached = null;
    cacheAt = 0;
    pendingCatalog = null;
  };
  const catalog = async () => {
    if (cached && Date.now() - cacheAt < 500) return cached;
    if (pendingCatalog) return pendingCatalog;
    const epoch = catalogEpoch;
    const request = workspace
      .catalog()
      .then(c => {
        if (epoch !== catalogEpoch) return catalog();
        cached = c;
        cacheAt = Date.now();
        return c;
      })
      .finally(() => {
        if (pendingCatalog === request) pendingCatalog = null;
      });
    pendingCatalog = request;
    return request;
  };
  const server = http.createServer(async (req, res) => {
    let fd;
    const json = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      check(
        req.socket.remoteAddress === "127.0.0.1" &&
          req.headers.host === `127.0.0.1:${server.address().port}`,
        "Loopback Host required"
      );
      check(
        !req.headers.origin || req.headers.origin === origin,
        "Cross-origin request forbidden"
      );
      check(
        !req.headers["sec-fetch-site"] ||
          ["same-origin", "none"].includes(req.headers["sec-fetch-site"]),
        "Cross-site request forbidden"
      );
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
      );
      const url = new URL(req.url, origin),
        pathname = url.pathname;
      if (
        req.method === "GET" &&
        ["/", "/app.mjs", "/assistant-ui.mjs", "/styles.css"].includes(pathname)
      ) {
        if (pathname === "/") {
          const id = secret();
          sessions.set(id, {
            csrf: secret(),
            actor: null,
            expires: Date.now() + 8 * 3600_000,
          });
          res.setHeader(
            "Set-Cookie",
            `basira_studio=${id}; HttpOnly; SameSite=Strict; Path=/`
          );
        }
        res.setHeader(
          "Content-Type",
          pathname.endsWith(".mjs")
            ? "text/javascript; charset=utf-8"
            : pathname.endsWith(".css")
              ? "text/css; charset=utf-8"
              : "text/html; charset=utf-8"
        );
        res.end(
          await readFile(
            resolve(ui, pathname === "/" ? "index.html" : pathname.slice(1))
          )
        );
        return;
      }
      const cookie = /(?:^|;\s*)basira_studio=([a-f0-9]{64})(?:;|$)/.exec(
        req.headers.cookie ?? ""
      )?.[1];
      const session = sessions.get(cookie);
      check(session && session.expires > Date.now(), "Session expired; reload");
      const body = async () => {
        check(
          req.headers["content-type"] === "application/json",
          "JSON required"
        );
        let text = "";
        for await (const chunk of req) {
          text += chunk;
          check(Buffer.byteLength(text) <= 24_000_000, "Request too large");
        }
        return JSON.parse(text);
      };
      if (req.method !== "GET")
        check(
          req.method === "POST" &&
            req.headers["x-studio-csrf"] === session.csrf,
          "CSRF token required"
        );
      if (pathname === "/api/bootstrap" && req.method === "GET") {
        json(200, {
          csrf: session.csrf,
          actor: session.actor,
          root: workspace.root,
        });
        return;
      }
      if (pathname === "/api/login" && req.method === "POST") {
        const p = await body();
        check(
          typeof p.id === "string" &&
            typeof p.password === "string" &&
            p.password.length <= 512,
          "Invalid login"
        );
        const prior = failures.get(p.id);
        check(
          !prior || prior.until < Date.now() || prior.count < 5,
          "Login temporarily locked"
        );
        let users;
        try {
          users = await workspace.json(".studio/identities.json");
        } catch {
          throw new Error("No local users configured; run --add-user");
        }
        const user = users.users.find(u => u.id === p.id);
        const salt = user?.salt ?? "0".repeat(32);
        const computed = passwordHash(p.password, salt);
        if (
          !user ||
          !timingSafeEqual(
            Buffer.from(computed, "hex"),
            Buffer.from(user.passwordHash, "hex")
          )
        ) {
          failures.set(p.id, {
            count: (prior?.count ?? 0) + 1,
            until: Date.now() + 60_000,
          });
          throw new Error("Invalid credentials");
        }
        failures.delete(p.id);
        session.actor = { id: user.id, name: user.name, roles: user.roles };
        session.csrf = secret();
        json(200, { actor: session.actor, csrf: session.csrf });
        return;
      }
      if (pathname === "/api/logout" && req.method === "POST") {
        session.actor = null;
        session.csrf = secret();
        json(200, { csrf: session.csrf });
        return;
      }
      check(session.actor, "Local account login required");
      if (pathname === "/api/review-plan" && req.method === "GET") {
        json(200, await reviewPlan(workspace));
        return;
      }
      if (req.method === "GET" && pathname === "/local-models.mjs") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(runtime.script);
        return;
      }
      if (req.method === "GET" && runtime.assets.has(pathname)) {
        const asset = runtime.assets.get(pathname);
        check(
          (await fileHash(asset.path)) === asset.sha256,
          "Bundled model asset changed"
        );
        res.setHeader("Content-Type", assetMime(pathname));
        res.end(await readFile(asset.path));
        return;
      }
      if (pathname === "/api/assistant/capabilities" && req.method === "GET") {
        json(200, runtime.manifest);
        return;
      }
      if (pathname === "/api/assistant/reports" && req.method === "GET") {
        json(200, {
          reports: await assistant.reports(
            workspace,
            url.searchParams.get("key")
          ),
        });
        return;
      }
      if (pathname === "/api/assistant/analyze" && req.method === "POST") {
        const p = await body();
        json(200, await assistant.analyze(workspace, p.key, session.actor));
        return;
      }
      if (
        pathname === "/api/assistant/model-results" &&
        req.method === "POST"
      ) {
        json(
          200,
          await assistant.saveModelReport(
            workspace,
            await body(),
            session.actor,
            runtime.manifest
          )
        );
        return;
      }
      if (pathname === "/api/assistant/scan" && req.method === "POST") {
        json(200, await assistant.scan(workspace));
        return;
      }
      if (pathname === "/api/assistant/review-pair" && req.method === "POST") {
        json(
          200,
          await assistant.reviewPair(workspace, await body(), session.actor)
        );
        return;
      }
      if (pathname === "/api/assistant/redact" && req.method === "POST") {
        const p = await body();
        json(200, await assistant.redact(workspace, p.key, p, session.actor));
        invalidateCatalog();
        return;
      }
      if (pathname === "/api/assistant/synthetic" && req.method === "POST") {
        json(
          200,
          await assistant.importSynthetic(
            workspace,
            await body(),
            session.actor
          )
        );
        invalidateCatalog();
        return;
      }
      if (pathname === "/api/assistant/packet" && req.method === "POST") {
        json(200, await assistant.needsPacket(workspace, session.actor));
        return;
      }
      if (pathname === "/api/catalog" && req.method === "GET") {
        const c = await catalog();
        json(200, { ...c, items: c.items.map(({ data, ...item }) => item) });
        return;
      }
      if (pathname === "/api/experiments" && req.method === "GET") {
        json(200, await workspace.experiments());
        return;
      }
      if (pathname === "/api/export-reviewed" && req.method === "POST") {
        const p = await body();
        json(200, await workspace.exportBatch(p.batch, session.actor));
        return;
      }
      const itemRoute = /^\/api\/items\/([a-f0-9]{32})$/.exec(pathname);
      if (itemRoute && req.method === "POST") {
        const result = await workspace.change(
          itemRoute[1],
          await body(),
          session.actor
        );
        invalidateCatalog();
        json(200, result);
        return;
      }
      const history = /^\/api\/history\/([a-f0-9]{32})$/.exec(pathname);
      if (history && req.method === "GET") {
        const paths = await workspace.revisions(history[1]);
        json(200, {
          revisions: await Promise.all(paths.map(p => workspace.json(p))),
        });
        return;
      }
      const evidence = /^\/api\/evidence\/([a-f0-9]{32})$/.exec(pathname);
      if (evidence && req.method === "GET") {
        json(200, {
          sources: await workspace.sourceEvidence(
            await workspace.item(evidence[1])
          ),
        });
        return;
      }
      const media = /^\/media\/(image|video)\/([a-f0-9]{32})$/.exec(pathname);
      if (media && req.method === "GET") {
        const c = await catalog();
        const item = (media[1] === "image" ? c.items : c.videos).find(
          i => i.key === media[2]
        );
        check(item, "Unknown media");
        const path =
          media[1] === "image"
            ? await workspace.mediaPath(
                item,
                url.searchParams.get("original") === "1"
              )
            : await workspace.safe(item.path);
        const expected =
          media[1] === "image"
            ? url.searchParams.get("original") === "1"
              ? item.sample.sha256
              : (item.activeSha256 ?? item.sample.sha256)
            : item.sha256;
        check(
          expected && (await fileHash(path)) === expected,
          "Media SHA-256 mismatch"
        );
        fd = await open(path, "r");
        const s = await fd.stat();
        check(s.isFile(), "Regular file required");
        const mime = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          webp: "image/webp",
          mp4: "video/mp4",
          webm: "video/webm",
          mov: "video/quicktime",
          mkv: "video/x-matroska",
        }[path.split(".").at(-1).toLowerCase()];
        check(mime, "Unsupported media");
        res.setHeader("Content-Type", mime);
        res.setHeader("Accept-Ranges", "bytes");
        let start = 0,
          end = s.size - 1;
        if (req.headers.range) {
          const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
          if (!range) {
            json(416, { error: "Unsupported range" });
            return;
          }
          start = +range[1];
          end = range[2]
            ? Math.min(+range[2], s.size - 1)
            : Math.min(start + 1024 * 1024 - 1, s.size - 1);
          if (start >= s.size || end < start) {
            res.setHeader("Content-Range", `bytes */${s.size}`);
            json(416, { error: "Invalid range" });
            return;
          }
          res.statusCode = 206;
          res.setHeader("Content-Range", `bytes ${start}-${end}/${s.size}`);
        }
        res.setHeader("Content-Length", end - start + 1);
        await new Promise((done, reject) => {
          const stream = fd.createReadStream({ start, end, autoClose: false });
          stream.on("error", reject);
          res.on("close", () => {
            stream.destroy();
            done();
          });
          stream.on("end", done);
          stream.pipe(res);
        });
        return;
      }
      json(404, { error: "Not found" });
    } catch (e) {
      if (!res.headersSent)
        json(e.message.includes("Revision conflict") ? 409 : 400, {
          error: e.message,
        });
      else res.destroy();
    } finally {
      if (fd) await fd.close().catch(() => {});
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  await new Promise((ok, no) => {
    server.once("error", no);
    server.listen(port, "127.0.0.1", ok);
  });
  return {
    server,
    workspace,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise(ok => {
        server.closeAllConnections();
        server.close(ok);
      }),
  };
}

async function addUser(root) {
  const workspace = await new StudioWorkspace(root).init();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const id = (await rl.question("Local identity ID (one per person): ")).trim();
  check(/^[a-z0-9_-]{3,40}$/.test(id), "Use a stable lowercase identity ID");
  const name = (await rl.question("Display name: ")).trim();
  check(name.length > 1 && name.length < 100, "Name required");
  const roles = (
    await rl.question(
      "Roles (annotator,rights,privacy,labels), comma separated: "
    )
  )
    .split(",")
    .map(s => s.trim());
  check(
    roles.length &&
      roles.every(r =>
        ["annotator", "rights", "privacy", "labels"].includes(r)
      ),
    "Unknown role"
  );
  rl.close();
  check(
    process.stdin.isTTY,
    "Interactive terminal required for hidden password entry"
  );
  const hidden = () =>
    new Promise(ok => {
      process.stdout.write("Password (min 12 characters; hidden): ");
      let value = "";
      process.stdin.setRawMode(true);
      process.stdin.resume();
      const read = chunk => {
        for (const c of chunk.toString()) {
          if (c === "\r" || c === "\n") {
            process.stdin.off("data", read);
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdout.write("\n");
            ok(value);
            return;
          }
          if (c === "\u0003") process.exit(130);
          if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
          else if (c.charCodeAt(0) >= 32) value += c;
        }
      };
      process.stdin.on("data", read);
    });
  const password = await hidden();
  check(
    password.length >= 12 && password.length <= 512,
    "Password length must be 12–512"
  );
  let identities;
  try {
    identities = await workspace.json(".studio/identities.json");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    identities = { users: [] };
  }
  check(
    !identities.users.some(
      u =>
        u.id === id || u.name.trim().toLowerCase() === name.trim().toLowerCase()
    ),
    "Identity exists; administrator reconciliation required"
  );
  const salt = secret();
  identities.users.push({
    id,
    name,
    roles: [...new Set(roles)],
    salt,
    passwordHash: passwordHash(password, salt),
  });
  const path = await workspace.safe(".studio/identities.json", true);
  await writeFile(path, JSON.stringify(identities, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(
    `Local identity ${id} created. Keep one identity per human; this is an administrator trust boundary.`
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const root = args[args.indexOf("--data-root") + 1];
  check(args.includes("--data-root") && root, "--data-root required");
  if (args.includes("--add-user")) await addUser(root);
  else {
    const port = args.includes("--port")
      ? Number(args[args.indexOf("--port") + 1])
      : 4318;
    check(
      Number.isSafeInteger(port) && port > 0 && port < 65536,
      "Invalid port"
    );
    const studio = await createStudio(root, { port });
    console.log(
      `Basira AI Training Studio: ${studio.url}\nLocal-only; training remains disabled.`
    );
    const stop = async () => {
      await studio.close();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  }
}
