import type { Express, Request, Response, NextFunction } from "express";
import type { Plugin } from "vite";
import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { validObjectQualityProfile } from "../shared/objectQuality";
const prefix = "/api/vision/object-quality";
const loopback = (ip: string | undefined) =>
  ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip ?? "");
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
export function objectQualityHandler({
  enabled = false,
  root = resolve(process.cwd(), ".vision-ai/object-quality"),
} = {}) {
  for (const publicRoot of ["client/public", "dist"]) {
    const rel = relative(resolve(publicRoot), resolve(root));
    if (!rel.startsWith("..") && !isAbsolute(rel))
      throw new Error("Object research assets cannot be published");
  }
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.url?.startsWith(prefix)) return next();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    const send = (status: number, value: unknown) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(value));
    };
    if (!enabled) {
      send(200, { enabled: false, profile: null });
      return;
    }
    if (
      !loopback(req.socket.remoteAddress) ||
      !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(
        req.headers.host ?? ""
      )
    ) {
      send(403, { error: "local_object_research_only" });
      return;
    }
    try {
      if (
        req.headers.origin &&
        new URL(req.headers.origin).host !== req.headers.host
      ) {
        send(403, { error: "origin_rejected" });
        return;
      }
    } catch {
      send(403, { error: "origin_rejected" });
      return;
    }
    if (!["GET", "HEAD"].includes(req.method ?? "")) {
      send(405, { error: "read_only_model_assets" });
      return;
    }
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.search) {
        send(400, { error: "query_rejected" });
        return;
      }
      const trainingRoots = {
        "objects-basira-v1": "finetuned",
        "objects-basira-v2": "finetuned-v2",
        "objects-basira-v3": "finetuned-v3",
      } as const;
      const modelId = (
        Object.keys(trainingRoots) as (keyof typeof trainingRoots)[]
      ).find(id => url.pathname.startsWith(prefix + "/models/" + id + "/"));
      const modelPrefix = prefix + "/models/" + modelId;
      const trainedRequest = Boolean(modelId);
      const activePrefix = trainedRequest ? modelPrefix : prefix;
      const activeRoot = modelId ? resolve(root, trainingRoots[modelId]) : root;
      const profile = JSON.parse(
        await readFile(resolve(activeRoot, "manifest.json"), "utf8")
      );
      const validLineage = async (candidate: typeof profile, folder: string) => {
        if (candidate.id !== "objects-basira-v3") return true;
        const base = await realpath(root), file = await realpath(resolve(folder, "yolox/LINEAGE.json"));
        const rel = relative(base, file);
        if (rel.startsWith("..") || isAbsolute(rel)) return false;
        const bytes = await readFile(file);
        if (bytes.length > 100_000 || hash(bytes) !== candidate.lineageEvidenceSha256) return false;
        const lineage = JSON.parse(bytes.toString("utf8"));
        return lineage.modelSha256 === candidate.modelSha256 &&
          lineage.initialTinySha256 === "9de513de589ac98bb92d3bca53b5af7b9acfa9b0bacb831f7999d0f7afaee8f0" &&
          lineage.usedRestrictedSources === false && lineage.usedV1OrV2WeightsOrTeacher === false &&
          lineage.commercialTrainingAllowed === true;
      };
      if (
        !validObjectQualityProfile(profile) ||
        profile.id !== (modelId ?? "objects-yolox-tiny") ||
        !(await validLineage(profile, activeRoot))
      )
        throw new Error("Unqualified object profile");
      if (url.pathname === prefix + "/manifest") {
        const profiles = [profile];
        for (const id of Object.keys(
          trainingRoots
        ) as (keyof typeof trainingRoots)[])
          try {
            const trained = JSON.parse(
              await readFile(
                resolve(root, trainingRoots[id], "manifest.json"),
                "utf8"
              )
            );
            if (validObjectQualityProfile(trained) && trained.id === id &&
                await validLineage(trained, resolve(root, trainingRoots[id])))
              profiles.push(trained);
          } catch {
            /* An absent/unqualified training run cannot hide the previous model. */
          }
        send(200, { enabled: true, profile, profiles });
        return;
      }
      if (url.pathname === prefix + "/knowledge" ||
          (modelId === "objects-basira-v3" && url.pathname === activePrefix + "/knowledge")) {
        const trained = modelId === "objects-basira-v3" ? profile : JSON.parse(
          await readFile(resolve(root, "finetuned-v2/manifest.json"), "utf8")
        );
        if (
          !validObjectQualityProfile(trained) ||
          !["objects-basira-v2","objects-basira-v3"].includes(trained.id)
        )
          throw new Error("Knowledge model unavailable");
        const file = await realpath(
          resolve(root, trained.id === "objects-basira-v3" ? "finetuned-v3/basira-knowledge.json" : "finetuned-v2/basira-knowledge.json")
        );
        const rel = relative(await realpath(root), file);
        if (rel.startsWith("..") || isAbsolute(rel))
          throw new Error("Knowledge outside registry");
        const bytes = await readFile(file);
        if (bytes.length > 3_000_000 || hash(bytes) !== trained.knowledgeSha256)
          throw new Error("Knowledge evidence changed");
        res.setHeader("Content-Type", "application/json");
        res.end(req.method === "HEAD" ? undefined : bytes);
        return;
      }
      const name = url.pathname.slice((activePrefix + "/assets/").length),
        asset = profile.assets[name];
      if (
        !url.pathname.startsWith(activePrefix + "/assets/") ||
        !asset ||
        !/^(yolox|slimsam)\/(onnx\/)?[a-zA-Z0-9_.-]+$/.test(name)
      ) {
        send(404, { error: "asset_not_registered" });
        return;
      }
      const file = await realpath(resolve(activeRoot, name)),
        base = await realpath(activeRoot),
        rel = relative(base, file);
      const registryRel = relative(await realpath(root), base);
      if (registryRel.startsWith("..") || isAbsolute(registryRel))
        throw new Error("Model outside registry");
      if (rel.startsWith("..") || isAbsolute(rel))
        throw new Error("Research asset outside registry");
      if (asset.bytes > 25_000_000) throw new Error("Research asset budget");
      const bytes = await readFile(file);
      if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256)
        throw new Error("Research asset identity changed");
      res.setHeader(
        "Content-Type",
        name.endsWith(".json")
          ? "application/json"
          : name.endsWith(".onnx")
            ? "application/octet-stream"
            : "text/plain"
      );
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch {
      send(503, { error: "object_quality_unavailable" });
    }
  };
}
export function registerObjectQualityRoutes(app: Express) {
  app.use(
    objectQualityHandler({
      enabled: process.env.BASIRA_ENABLE_OBJECT_QUALITY === "1",
    })
  );
}
export function vitePluginObjectQuality(): Plugin {
  return {
    name: "basira-local-object-quality",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(objectQualityHandler({ enabled: true }) as never);
    },
  };
}
