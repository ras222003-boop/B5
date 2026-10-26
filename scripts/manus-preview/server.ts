/** Opt-in, read-only preview of the EXISTING app. No import of auth, databases, cloud APIs or Studio. */
import express from "express";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { timingSafeEqual, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { objectQualityHandler } from "../../server/objectQuality";
import { PINNED } from "./pins.mjs";
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const same = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export async function createPreviewApp({
  origin,
  username,
  password,
  buildRoot,
  registryRoot,
  modelsEnabled = false,
}: {
  origin: string;
  username: string;
  password: string;
  buildRoot: string;
  registryRoot: string;
  modelsEnabled?: boolean;
}) {
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.hostname === "basira-ve3h8rof.manus.space" ||
    !username ||
    username.includes(":") ||
    password.length < 24
  )
    throw Error(
      "A separate exact HTTPS origin and independent strong preview credentials are required"
    );
  const app = express(),
    receipt = JSON.parse(
      await readFile(resolve(buildRoot, "build-receipt.json"), "utf8")
    );
  if (
    !/^[a-f0-9]{40}$/.test(receipt.sourceCommit) ||
    receipt.databaseConnected !== false ||
    receipt.weightsIncluded !== false
  )
    throw Error("Invalid isolated build receipt");
  const raw = objectQualityHandler({
    enabled: modelsEnabled,
    root: registryRoot,
  });
  if (modelsEnabled) {
    const admission = JSON.parse(
      await readFile(resolve(registryRoot, "preview-admission.json"), "utf8")
    );
    if (
      admission.sourceCommit !== receipt.sourceCommit ||
      admission.schemaVersion !== 1 ||
      admission.maskModelsIncluded !== false ||
      admission.restrictedModelsIncluded !== false
    )
      throw Error("Unqualified preview package");
    for (const file of admission.files ?? []) {
      if (
        !/^(manifest\.json|yolox\/(LICENSE|README\.md|yolox_tiny\.onnx)|finetuned-v3\/(manifest\.json|basira-knowledge\.json|yolox\/(LICENSE|LICENSE-YCB|LINEAGE\.json|DATA-ATTRIBUTIONS\.json|yolox_tiny\.onnx)))$/.test(
          file.path
        )
      )
        throw Error("Unexpected preview asset");
      const bytes = await readFile(resolve(registryRoot, file.path));
      if (bytes.length !== file.bytes || hash(bytes) !== file.sha256)
        throw Error("Preview package identity changed");
    }
    const ids = admission.models?.map((m: { id: string }) => m.id).sort();
    if (JSON.stringify(ids) !== '["objects-basira-v3","objects-yolox-tiny"]')
      throw Error("Only qualified Tiny and V3 may be exposed");
    for (const m of admission.models)
      if (m.sha256 !== PINNED[m.id as keyof typeof PINNED])
        throw Error("Changed preview model rejected");
    for (const [folder, id] of [
      ["", "objects-yolox-tiny"],
      ["finetuned-v3/", "objects-basira-v3"],
    ] as const) {
      const bytes = await readFile(
        resolve(registryRoot, folder + "yolox/yolox_tiny.onnx")
      );
      if (hash(bytes) !== PINNED[id])
        throw Error("Actual model differs from pinned qualified weights");
    }
  }
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",
      "Content-Security-Policy":
        "default-src 'self'; connect-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'",
    });
    // Exact Host: never trust arbitrary forwarded headers or use a wildcard Manus domain.
    if (
      req.headers.host !== url.host ||
      (req.headers.origin && req.headers.origin !== origin) ||
      ["cross-site", "same-site"].includes(
        String(req.headers["sec-fetch-site"] ?? "")
      )
    )
      return void res.status(403).end("Origin rejected");
    if (
      !["GET", "HEAD"].includes(req.method) ||
      Number(req.headers["content-length"] ?? 0) > 0 ||
      req.headers["transfer-encoding"]
    )
      return void res
        .status(405)
        .end("Read-only preview: uploads and writes disabled");
    const expected =
      "Basic " + Buffer.from(username + ":" + password).toString("base64");
    if (!same(req.headers.authorization ?? "", expected)) {
      res.set(
        "WWW-Authenticate",
        'Basic realm="Basira isolated preview", charset="UTF-8"'
      );
      return void res.status(401).end("Preview sign-in required");
    }
    next();
  });
  app.get("/api/preview/status", (_req, res) =>
    res.json({
      ...receipt,
      modelsAvailable: modelsEnabled,
      mediaUploads: false,
      microphonePermissionTestAvailable: true,
      iphoneTested: false,
      navigationEligible: false,
    })
  );
  app.use(async (req, res, next) => {
    if (!req.path.startsWith("/api/vision/object-quality")) return next();
    if (req.path === "/api/vision/object-quality/manifest") {
      const facade = {
        url: req.url,
        method: req.method,
        headers: { host: "localhost" },
        socket: { remoteAddress: "127.0.0.1" },
      };
      const capture = {
        setHeader: () => {},
        statusCode: 200,
        end: (data?: string) => {
          if (capture.statusCode !== 200)
            return void res
              .status(capture.statusCode)
              .json({ error: "preview_models_unavailable" });
          const value = JSON.parse(data ?? "{}");
          value.profiles = (value.profiles ?? [value.profile]).filter(
            (p: { id?: string } | null) =>
              p &&
              ["objects-yolox-tiny", "objects-basira-v3"].includes(p.id ?? "")
          );
          res.json(value);
        },
      };
      await raw(facade as never, capture as never, next);
      return;
    }
    if (
      !/^\/api\/vision\/object-quality\/(?:models\/objects-basira-v3\/)?(?:assets\/yolox\/(?:yolox_tiny\.onnx|LICENSE|LICENSE-YCB|README\.md|LINEAGE\.json|DATA-ATTRIBUTIONS\.json)|knowledge)$/.test(
        req.path
      )
    )
      return void res.status(404).end("Unregistered preview asset");
    const resourceUrl =
      req.path === "/api/vision/object-quality/knowledge"
        ? "/api/vision/object-quality/models/objects-basira-v3/knowledge"
        : req.url;
    await raw(
      {
        url: resourceUrl,
        method: req.method,
        headers: { host: "localhost" },
        socket: { remoteAddress: "127.0.0.1" },
      } as never,
      res,
      next
    );
  });
  app.use(
    "/api",
    (_req, res) =>
      void res.status(503).json({
        error: "ISOLATED_VISION_PREVIEW",
        databaseConnected: false,
        cloudServicesEnabled: false,
      })
  );
  app.use((req, res, next) => {
    if (
      /(?:^|\/)\.|Xenova|onnx-community|\.pem$|\.cer$|\.key$/i.test(
        decodeURIComponent(req.path)
      )
    )
      return void res.status(404).end();
    next();
  });
  app.use(
    express.static(resolve(buildRoot, "app"), {
      dotfiles: "deny",
      fallthrough: true,
      setHeaders: res =>
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin"),
    })
  );
  app.get("*", (req, res) => {
    if (!["/", "/navigation/vision"].includes(req.path))
      return void res
        .status(404)
        .end(
          "Only the existing vision page is exposed in this isolated preview"
        );
    res.sendFile(resolve(buildRoot, "app/index.html"));
  });
  return app;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const app = await createPreviewApp({
    origin: process.env.BASIRA_PREVIEW_ORIGIN ?? "",
    username: process.env.BASIRA_PREVIEW_ACCESS_USERNAME ?? "",
    password: process.env.BASIRA_PREVIEW_ACCESS_PASSWORD ?? "",
    buildRoot: resolve(import.meta.dirname),
    registryRoot: resolve(
      process.env.BASIRA_PREVIEW_MODEL_ROOT ?? ".vision-ai/manus-preview-models"
    ),
    modelsEnabled: process.env.BASIRA_PREVIEW_ENABLE_MODELS === "1",
  });
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("Invalid preview port");
  app.listen(port, "0.0.0.0", () =>
    console.log(
      JSON.stringify({
        port,
        isolatedVisionPreview: true,
        databaseConnected: false,
        cloudServicesEnabled: false,
      })
    )
  );
}
