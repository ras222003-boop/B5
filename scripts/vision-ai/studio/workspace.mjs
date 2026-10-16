import {
  access,
  constants,
  lstat,
  realpath,
  readdir,
  readFile,
  mkdir,
  writeFile,
  open,
  unlink,
  link,
} from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { outsideGit } from "../storage.mjs";
import {
  hash,
  fileHash,
  validBox,
  readJson,
  taxonomyPath,
  requireValue as check,
} from "../common.mjs";
import { validateSource, validateDataset } from "../data.mjs";
import { validateSpatial, unknownSpatial } from "../spatial.mjs";
import {
  validateStairsDirection,
  validCaptureMotion,
  knownSceneConditions,
} from "../stairs-task.mjs";
import { rightsBlocked, releaseGroups } from "./assistant.mjs";

export class StudioWorkspace {
  constructor(root) {
    this.root = resolve(root);
    this.busy = false;
  }
  async init() {
    await outsideGit(this.root);
    await this.safe("storage.json");
    check(
      (await readJson(resolve(this.root, "storage.json"))).name ===
        "Basira-Vision-Datasets",
      "Initialize Basira storage using existing storage-init first"
    );
    await access(this.root, constants.R_OK | constants.W_OK);
    await this.ensure(".studio");
    await this.ensure(".studio/items");
    await this.ensure(".studio/derived");
    this.taxonomy = await readJson(taxonomyPath);
    return this;
  }
  async safe(path, missing = false) {
    check(
      typeof path === "string" &&
        path.length > 0 &&
        !path.includes("\\") &&
        !path.includes(":") &&
        !path.startsWith("/") &&
        !path.split("/").some(p => !p || p === "." || p === ".."),
      "Invalid data path"
    );
    const root = await realpath(this.root);
    check(root === this.root, "Data root cannot be a symlink");
    const parts = path.split("/");
    let p = root;
    for (let i = 0; i < parts.length; i++) {
      p = resolve(p, parts[i]);
      try {
        const s = await lstat(p);
        check(!s.isSymbolicLink() && !s.isBlockDevice(), "Links forbidden");
        // Reparse points/junctions must not escape even when reported as directories.
        check((await realpath(p)) === p, "Reparse paths forbidden");
      } catch (e) {
        if (e.code === "ENOENT" && missing && i === parts.length - 1) return p;
        throw e;
      }
    }
    check(!relative(root, p).startsWith(".." + sep), "Path outside data root");
    return p;
  }
  async ensure(path) {
    const p = await this.safe(path, true);
    await mkdir(p, { recursive: false }).catch(e => {
      if (e.code !== "EEXIST") throw e;
    });
    return this.safe(path);
  }
  async json(path) {
    const p = await this.safe(path);
    check((await lstat(p)).size < 20_000_000, "JSON file too large");
    return JSON.parse(await readFile(p, "utf8"));
  }
  async catalog() {
    const dirs = [];
    const issues = [];
    const visit = async (path, depth) => {
      if (depth > 7) return;
      for (const e of await readdir(path, { withFileTypes: true })) {
        if (
          e.name === ".studio" ||
          e.name === "exports" ||
          e.name === "runs" ||
          e.name === "registry" ||
          e.name === "source-records" ||
          e.name === "rights" ||
          e.name === "reproducibility"
        )
          continue;
        const p = resolve(path, e.name),
          rel = relative(this.root, p).split(sep).join("/");
        if (e.isSymbolicLink()) {
          issues.push({ path: rel, error: "symbolic link skipped" });
          continue;
        }
        if (e.isDirectory()) {
          try {
            await this.safe(rel);
            await visit(p, depth + 1);
          } catch (e) {
            issues.push({ path: rel, error: e.message });
          }
        }
      }
      dirs.push(path);
    };
    await visit(this.root, 0);
    const items = [],
      videos = [],
      batches = [];
    for (const dir of dirs) {
      const names = (await readdir(dir)).filter(
        n =>
          /^dataset.*\.json$/.test(n) ||
          /^bundle\.(pending|approved|json).*\.json$/.test(n) ||
          n === "bundle.json" ||
          n === "inventory.json"
      );
      const score = n =>
        n.includes("frozen")
          ? 10
          : n.includes("reviewed")
            ? 9
            : n.includes("review.pending")
              ? 8
              : n.startsWith("dataset")
                ? 7
                : n.includes("approved")
                  ? 5
                  : 1;
      names.sort((a, b) => score(b) - score(a) || a.localeCompare(b));
      let data,
        manifest,
        invalid = false;
      for (const name of names) {
        const p = relative(this.root, resolve(dir, name)).split(sep).join("/");
        try {
          const d = await this.json(p);
          if (
            d.schemaVersion === 1 &&
            Array.isArray(d.samples) &&
            d.samples.length
          ) {
            data = d;
            manifest = p;
            break;
          }
        } catch (e) {
          issues.push({ path: p, error: e.message });
          invalid = true;
          break;
        }
      }
      if (invalid || !data) continue;
      const prefix = relative(this.root, dir).split(sep).join("/");
      const baseHash = hash(JSON.stringify(data));
      const batchKey = hash(`${prefix}:${data.id}`).slice(0, 32);
      batches.push({
        key: batchKey,
        id: data.id,
        manifest,
        contentKind: data.contentKind ?? "real",
        sampleCount: data.samples.length,
      });
      const imageSourceIds = new Set(data.samples.map(s => s.sourceId));
      for (const sample of data.samples) {
        const key = hash(`${prefix}:${sample.id}:${sample.path}`).slice(0, 32);
        const item = {
          key,
          batch: data.id,
          batchKey,
          contentKind: data.contentKind ?? "real",
          manifest,
          prefix,
          baseHash,
          version: 0,
          sample: structuredClone(sample),
          sources: structuredClone(
            (data.sources ?? []).filter(
              s => s.id === sample.sourceId || !imageSourceIds.has(s.id)
            )
          ),
          motionSegments: (data.motionSegments ?? []).filter(
            m =>
              sample.media?.video?.sha256 === m.videoSha256 &&
              sample.annotation?.objects?.some(o => o.trackId === m.trackId)
          ),
          data,
        };
        try {
          check(
            /\.(png|jpe?g|webp)$/i.test(sample.path),
            "Unsupported image path"
          );
          await this.safe(`${prefix ? prefix + "/" : ""}${sample.path}`);
          item.sample.sha256 ??= await fileHash(await this.mediaPath(item));
          if (!item.sample.width || !item.sample.height) {
            const { default: sharp } = await import("sharp");
            const meta = await sharp(await this.mediaPath(item)).metadata();
            item.sample.width = meta.width;
            item.sample.height = meta.height;
          }
          item.sample.annotation ??= {
            status: "pending",
            annotator: "",
            reviewer: "",
            exhaustive: false,
            objects: [],
            surfaces: [],
          };
          item.sample.privacy ??= {
            status: "pending",
            reviewer: "",
            at: "",
            faces: "unreviewed",
            plates: "unreviewed",
            personalText: "unreviewed",
            metadataStripped: false,
          };
          const revisions = await this.revisions(key);
          if (revisions.length) {
            let previous = null;
            for (const [index, path] of revisions.entries()) {
              const record = await this.json(path);
              check(
                record.key === key &&
                  record.version === index + 1 &&
                  record.parentSha256 === previous,
                "Revision chain integrity failure"
              );
              previous = await fileHash(await this.safe(path));
            }
            const r = await this.json(revisions.at(-1));
            if (r.baseHash !== baseHash) {
              item.conflict = true;
              item.version = r.version;
            } else {
              item.version = r.version;
              item.sample = r.sample;
              item.sources = r.sources;
              item.activePath = r.activePath;
              item.activeSha256 = r.activeSha256;
              item.decisions = r.decisions;
              item.lastActor = r.actor;
            }
          }
          item.measurements = {};
          for (const object of item.sample.annotation.objects)
            if (object.spatial?.distance?.status === "measured") {
              try {
                await this.checkReferences(object.spatial, item.prefix);
                await validateSpatial(
                  object.spatial,
                  item.sample,
                  resolve(this.root, item.prefix),
                  true
                );
                item.measurements[object.id] = { validContract: true };
              } catch (e) {
                item.measurements[object.id] = {
                  validContract: false,
                  error: e.message,
                };
              }
            }
          item.status = this.status(item);
          items.push(item);
        } catch (e) {
          issues.push({ path: sample.path, error: e.message });
        }
      }
      for (const f of data.files ?? [])
        if (f.kind === "video")
          try {
            const path = `${prefix ? prefix + "/" : ""}${f.path}`;
            check(
              /\.(mp4|webm|mov|mkv)$/i.test(path),
              "Unsupported video path"
            );
            await this.safe(path);
            videos.push({
              key: hash(path).slice(0, 32),
              batch: data.id,
              path,
              sourceId: f.sourceId,
              sha256: f.sha256,
            });
          } catch (e) {
            issues.push({ path: f.path, error: e.message });
          }
      for (const s of data.samples)
        if (s.media?.video) {
          const v = s.media.video,
            path = `${prefix ? prefix + "/" : ""}${v.path}`;
          if (!videos.some(i => i.path === path))
            try {
              check(
                /\.(mp4|webm|mov|mkv)$/i.test(path),
                "Unsupported video path"
              );
              await this.safe(path);
              videos.push({
                key: hash(path).slice(0, 32),
                batch: data.id,
                ...v,
                path,
              });
            } catch (e) {
              issues.push({ path, error: e.message });
            }
        }
    }
    const classCounts = {};
    for (const item of items)
      for (const id of new Set(
        (item.sample.annotation?.objects ?? []).map(o => o.classId)
      ))
        classCounts[id] = (classCounts[id] ?? 0) + 1;
    return {
      items,
      videos,
      batches,
      issues,
      summary: {
        images: items.length,
        videos: videos.length,
        approved: items.filter(i => i.status === "approved").length,
        rejected: items.filter(i => i.status === "rejected").length,
        incomplete: items.filter(i => i.status === "incomplete").length,
        pending: items.filter(i => i.status === "pending").length,
        classCounts,
      },
      taxonomy: this.taxonomy,
    };
  }
  status(i) {
    if (i.conflict) return "incomplete";
    const s = i.sample;
    if (Object.values(i.decisions ?? {}).some(d => d.status === "rejected"))
      return "rejected";
    if (
      i.sources.length &&
      i.sources.every(x => x.rightsReview?.status === "approved") &&
      s.privacy?.status === "approved" &&
      s.annotation?.status === "reviewed" &&
      s.annotation?.exhaustive
    )
      return "approved";
    if (!s.annotation?.objects?.length || !s.annotation?.annotator)
      return "incomplete";
    return "pending";
  }
  async revisions(key) {
    check(/^[a-f0-9]{32}$/.test(key), "Invalid item ID");
    try {
      const p = await this.safe(`.studio/items/${key}`);
      return (await readdir(p))
        .filter(n => /^\d{6}\.json$/.test(n))
        .sort()
        .map(n => `.studio/items/${key}/${n}`);
    } catch (e) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
  }
  async item(key) {
    const i = (await this.catalog()).items.find(i => i.key === key);
    check(i, "Unknown item");
    return i;
  }
  async mediaPath(i, original = false) {
    return this.safe(
      !original && i.activePath
        ? i.activePath
        : `${i.prefix ? i.prefix + "/" : ""}${i.sample.path}`
    );
  }
  async sourceEvidence(item) {
    const results = [];
    for (const s of item.sources) {
      const path = `${item.prefix ? item.prefix + "/" : ""}${s.rightsReview?.evidence?.path}`;
      const file = await this.safe(path);
      check(
        (await fileHash(file)) === s.rightsReview.evidence.sha256,
        "Rights evidence SHA mismatch"
      );
      check(
        (await lstat(file)).size < 2_000_000,
        "Evidence too large for preview"
      );
      results.push({
        sourceId: s.id,
        path,
        sha256: s.rightsReview.evidence.sha256,
        text: await readFile(file, "utf8"),
      });
    }
    return results;
  }
  async checkReferences(value, prefix) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (["evidence", "calibrationEvidence"].includes(key) && child?.path) {
        const path = `${prefix ? prefix + "/" : ""}${child.path}`;
        check(
          (await fileHash(await this.safe(path))) === child.sha256,
          "Evidence SHA mismatch"
        );
      } else if (typeof child === "object")
        await this.checkReferences(child, prefix);
    }
  }
  async contributors(item) {
    const original = item.data.samples.find(s => s.id === item.sample.id);
    const people = new Set(
      [
        original?.annotation?.annotator,
        original?.generation?.uploadedBy,
        item.sample.annotation?.annotator,
      ].filter(Boolean)
    );
    for (const path of await this.revisions(item.key)) {
      const r = await this.json(path);
      if (r.action !== "review") people.add(r.actor);
    }
    return people;
  }
  async change(
    key,
    payload,
    actor,
    { proposalAudit = null, batchAudit = null } = {}
  ) {
    check(!this.busy, "Another edit is active; retry");
    this.busy = true;
    let lock;
    try {
      lock = await open(
        await this.safe(".studio/write.lock", true),
        "wx",
        0o600
      );
      const item = await this.item(key);
      await (
        await import("../test-cohort.mjs")
      ).assertNotFinalTest(this.root, item);
      check(
        !item.conflict,
        "Manifest changed; reconcile into a new batch before editing"
      );
      check(
        (await fileHash(await this.mediaPath(item))) ===
          (item.activeSha256 ?? item.sample.sha256),
        "Media SHA-256 mismatch; reconcile changed input"
      );
      if (payload.version !== item.version)
        throw Object.assign(
          new Error("Revision conflict; refresh before saving"),
          { code: "REVISION_CONFLICT", currentVersion: item.version }
        );
      if (payload.baseHash !== undefined)
        check(
          payload.baseHash === item.baseHash,
          "Manifest changed; reload before saving"
        );
      if (payload.imageSha256 !== undefined)
        check(
          payload.imageSha256 === (item.activeSha256 ?? item.sample.sha256),
          "Media SHA mismatch; reload before saving"
        );
      check(
        typeof payload.reason === "string" &&
          payload.reason.trim().length >= 3 &&
          payload.reason.length <= 2000,
        "Decision reason required"
      );
      const can = role =>
        check(actor.roles.includes(role), "Role not authorized");
      const reset = () => {
        const rejectedRights = rightsBlocked(item);
        const rightsDecision = item.decisions?.rights;
        item.sample.annotation = {
          ...item.sample.annotation,
          status: "pending",
          annotator: actor.id,
          reviewer: "",
          exhaustive: false,
        };
        item.sample.privacy = {
          ...item.sample.privacy,
          status: "pending",
          reviewer: "",
          at: "",
        };
        item.sources = item.sources.map(s => ({
          ...s,
          trainingAllowed: false,
          rightsReview: {
            ...s.rightsReview,
            status: rejectedRights ? "rejected" : "pending",
            reviewer: "",
            at: "",
          },
        }));
        item.decisions = rejectedRights
          ? {
              rights: rightsDecision ?? {
                status: "rejected",
                reason: "Rights rejection preserved",
              },
            }
          : {};
      };
      const at = new Date().toISOString();
      const bundled = ["prepare-bundle", "review-bundle"].includes(
        payload.action
      );
      if (bundled)
        check(
          batchAudit?.verified === true,
          "Batch receipt required; use authenticated batch review"
        );
      const applyAction = async payload => {
        if (payload.action === "labels") {
          can("annotator");
          check(
            Array.isArray(payload.objects) && payload.objects.length <= 1000,
            "Invalid annotations"
          );
          const ids = new Set(),
            boxes = new Set(),
            tracks = new Set();
          for (const o of payload.objects) {
            validateStairsDirection(o);
            check(
              typeof o.id === "string" && o.id.length > 0 && !ids.has(o.id),
              "Unique object ID required"
            );
            ids.add(o.id);
            check(
              this.taxonomy.classes.some(
                c => c.id === o.classId && c.kind !== "surface"
              ) && validBox(o.box),
              "Invalid class or bounding box"
            );
            const geometry = `${o.classId}:${o.box}`;
            check(!boxes.has(geometry), "Duplicate box");
            boxes.add(geometry);
            check(
              typeof o.occluded === "boolean" &&
                typeof o.truncated === "boolean" &&
                ["yes", "no", "unknown"].includes(o.groundContact),
              "Object attributes required"
            );
            check(
              item.sample.media?.kind === "video_frame"
                ? typeof o.trackId === "string" && !!o.trackId
                : o.trackId === null,
              "Track identity mismatch"
            );
            if (o.trackId !== null) {
              check(!tracks.has(o.trackId), "Duplicate frame track");
              tracks.add(o.trackId);
            }
            const prior = item.sample.annotation?.objects?.find(
              p => p.id === o.id
            );
            check(
              JSON.stringify(o.spatial) === JSON.stringify(prior?.spatial),
              "Measured spatial evidence must be edited using existing spatial tools"
            );
            if (o.spatial) {
              await this.checkReferences(o.spatial, item.prefix);
              await validateSpatial(
                o.spatial,
                item.sample,
                resolve(this.root, item.prefix),
                true
              );
            }
          }
          if (payload.conditions) {
            check(
              [
                "unreviewed",
                "daylight",
                "indoor",
                "low_light",
                "mixed",
              ].includes(payload.conditions.lighting) &&
                ["unreviewed", "indoor", "outdoor"].includes(
                  payload.conditions.scene
                ) &&
                (payload.conditions.motion === "unreviewed" ||
                  validCaptureMotion(
                    {
                      ...item.sample,
                      annotation: {
                        ...item.sample.annotation,
                        objects: payload.objects,
                      },
                    },
                    payload.conditions.motion
                  )),
              "Scene conditions required; unknown capture motion is only for stairs still images without metric measurements"
            );
            item.sample.conditions = payload.conditions;
          }
          reset();
          item.sample.annotation.objects = payload.objects.map(o =>
            item.data.spatialPolicyVersion
              ? { ...o, spatial: o.spatial ?? unknownSpatial() }
              : o
          );
        } else if (payload.action === "derivative") {
          can("annotator");
          check(
            !rightsBlocked(item),
            "Rights rejected: derivatives cannot bypass rights"
          );
          const { default: sharp } = await import("sharp");
          let bytes;
          if (payload.normalizeOrientation === true) {
            // Only unlabelled stills: transformed annotations/calibration require
            // an explicit new intake, never a silent box-coordinate conversion.
            check(
              !item.sample.annotation.objects.length &&
                !(item.sample.annotation.surfaces ?? []).length &&
                item.sample.media?.kind === "image" &&
                !item.motionSegments.length,
              "Orientation normalization requires an unlabelled still image"
            );
            const original = await this.mediaPath(item, true);
            check(
              (await fileHash(original)) === item.sample.sha256,
              "Original media SHA-256 mismatch; cannot normalize changed input"
            );
            const metadata = await sharp(original).metadata();
            check(
              metadata.orientation >= 2 && metadata.orientation <= 8,
              "Original has no EXIF orientation to normalize"
            );
            bytes = await sharp(original).autoOrient().png().toBuffer();
            const normalized = await sharp(bytes).metadata();
            item.sample.width = normalized.width;
            item.sample.height = normalized.height;
          } else {
            check(
              typeof payload.image === "string" &&
                payload.image.length < 24_000_000,
              "Image upload limit exceeded"
            );
            bytes = Buffer.from(payload.image, "base64");
          }
          const m = await sharp(bytes, {
            limitInputPixels: 100_000_000,
          }).metadata();
          check(
            ["jpeg", "png", "webp"].includes(m.format) &&
              (m.pages ?? 1) === 1 &&
              (!m.orientation || m.orientation === 1) &&
              m.width === item.sample.width &&
              m.height === item.sample.height,
            "Derivative must preserve dimensions/orientation and be single-frame"
          );
          const clean = await sharp(bytes).png().toBuffer();
          const sha = hash(clean),
            path = `.studio/derived/${sha}.png`;
          try {
            await writeFile(await this.safe(path, true), clean, {
              flag: "wx",
              mode: 0o600,
            });
          } catch (e) {
            if (e.code !== "EEXIST") throw e;
            check(
              (await fileHash(await this.safe(path))) === sha,
              "Derivative collision"
            );
          }
          reset();
          item.activePath = path;
          item.activeSha256 = sha;
        } else if (payload.action === "review") {
          check(
            ["rights", "privacy", "labels"].includes(payload.kind) &&
              ["approved", "rejected"].includes(payload.status),
            "Invalid review"
          );
          can(payload.kind);
          const contributor = item.sample.annotation?.annotator;
          check(
            contributor && !(await this.contributors(item)).has(actor.id),
            "Independent reviewer must differ from contributor"
          );
          if (payload.status === "approved") {
            if (payload.kind === "rights") {
              check(
                !rightsBlocked(item),
                "Rights rejected: use a new independent licensed source, not modified rejected pixels"
              );
              check(item.sources.length > 0, "Rights sources missing");
              await this.sourceEvidence(item);
              for (const s of item.sources) {
                s.trainingAllowed = true;
                s.rightsReview = {
                  ...s.rightsReview,
                  status: "approved",
                  reviewer: actor.id,
                  at,
                  reason: payload.reason,
                };
                await validateSource(s, resolve(this.root, item.prefix), true);
              }
            } else if (payload.kind === "privacy") {
              check(
                payload.metadataStripped === true &&
                  ["absent", "redacted"].includes(payload.faces) &&
                  ["absent", "redacted"].includes(payload.plates) &&
                  ["absent", "redacted"].includes(payload.personalText),
                "Explicit privacy decisions required"
              );
              const { default: sharp } = await import("sharp");
              const m = await sharp(await this.mediaPath(item)).metadata();
              check(
                !m.exif && !m.xmp && !m.iptc && !m.comments?.length,
                "Strip metadata in a derivative before privacy approval"
              );
              item.sample.privacy = {
                status: "approved",
                reviewer: actor.id,
                at,
                reason: payload.reason,
                faces: payload.faces,
                plates: payload.plates,
                personalText: payload.personalText,
                metadataStripped: true,
              };
            } else {
              check(
                payload.exhaustive === true,
                "Exhaustive independent label review required"
              );
              check(
                knownSceneConditions(item.sample),
                "Scene conditions required"
              );
              item.sample.annotation = {
                ...item.sample.annotation,
                status: "reviewed",
                reviewer: actor.id,
                at,
                reason: payload.reason,
                exhaustive: true,
              };
            }
          }
          if (payload.status === "rejected") {
            if (payload.kind === "rights")
              item.sources = item.sources.map(s => ({
                ...s,
                trainingAllowed: false,
                rightsReview: {
                  ...s.rightsReview,
                  status: "rejected",
                  reviewer: actor.id,
                  at,
                  reason: payload.reason,
                },
              }));
            if (payload.kind === "privacy")
              item.sample.privacy = {
                ...item.sample.privacy,
                status: "rejected",
                reviewer: actor.id,
                at,
                reason: payload.reason,
              };
            if (payload.kind === "labels")
              item.sample.annotation = {
                ...item.sample.annotation,
                status: "rejected",
                reviewer: actor.id,
                at,
                reason: payload.reason,
                exhaustive: false,
              };
          }
          item.decisions ??= {};
          item.decisions[payload.kind] = {
            status: payload.status,
            reviewer: actor.id,
            at,
            reason: payload.reason,
            itemKey: key,
            imageSha256: item.activeSha256 ?? item.sample.sha256,
            evidence: item.sources.map(s => ({
              sourceId: s.id,
              ...s.rightsReview?.evidence,
            })),
            version: item.version + 1,
          };
        } else throw new Error("Unknown action");
      };
      const steps =
        payload.action === "prepare-bundle"
          ? [
              { ...payload, action: "labels" },
              ...(payload.image ? [{ ...payload, action: "derivative" }] : []),
            ]
          : payload.action === "review-bundle"
            ? ["rights", "privacy", "labels"].map(kind => ({
                ...payload,
                action: "review",
                kind,
                status: "approved",
              }))
            : [payload];
      for (const step of steps) await applyAction(step);
      const history = await this.revisions(key);
      const prev = history.length
        ? await fileHash(await this.safe(history.at(-1)))
        : null;
      const version = item.version + 1;
      await this.ensure(`.studio/items/${key}`);
      const revision = {
        schemaVersion: 1,
        key,
        version,
        baseHash: item.baseHash,
        parentSha256: prev,
        actor: actor.id,
        at,
        action:
          payload.action === "review-bundle"
            ? "review"
            : payload.action === "prepare-bundle"
              ? "labels"
              : payload.action,
        steps: steps.map(s => ({
          action: s.action,
          ...(s.kind ? { kind: s.kind } : {}),
        })),
        batchAudit,
        reason: payload.reason,
        sample: item.sample,
        sources: item.sources,
        activePath: item.activePath ?? null,
        activeSha256: item.activeSha256 ?? null,
        decisions: item.decisions ?? {},
        // Only an internal call can supply verified proposal provenance. Never read it from payload.
        proposalAudit,
        assistantAudit: payload.assistantAudit
          ? {
              method:
                payload.assistantAudit.method === "solid-mask"
                  ? "solid-mask"
                  : "operator-assertion",
              regions: Array.isArray(payload.assistantAudit.regions)
                ? payload.assistantAudit.regions.filter(validBox).slice(0, 100)
                : [],
              inputSha256: /^[a-f0-9]{64}$/.test(
                payload.assistantAudit.inputSha256 ?? ""
              )
                ? payload.assistantAudit.inputSha256
                : null,
              reportIds: Array.isArray(payload.assistantAudit.reportIds)
                ? payload.assistantAudit.reportIds
                    .filter(
                      id => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id)
                    )
                    .slice(0, 10)
                : [],
              attestation:
                "Operator-supplied rationale; not an approval or verified model inference",
            }
          : null,
      };
      const path = `.studio/items/${key}/${String(version).padStart(6, "0")}.json`;
      // Publish a complete immutable revision without overwriting an existing version.
      const temporary = `${path}.${randomUUID()}.tmp`;
      const temporaryPath = await this.safe(temporary, true);
      const handle = await open(temporaryPath, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(revision, null, 2) + "\n");
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await link(temporaryPath, await this.safe(path, true));
      } finally {
        await unlink(temporaryPath);
      }
      return { version, status: this.status(item) };
    } finally {
      try {
        if (lock) {
          await lock.close();
          await unlink(resolve(this.root, ".studio/write.lock"));
        }
      } finally {
        this.busy = false;
      }
    }
  }
  /** Snapshot for the existing validator/split/export pipeline. Never modifies input manifests or starts training. */
  async exportBatch(batch, actor, { keys = null } = {}) {
    check(
      actor.roles.includes("labels"),
      "Independent label reviewer role required"
    );
    check(!this.busy, "Another edit is active; retry");
    this.busy = true;
    let lock;
    try {
      lock = await open(
        await this.safe(".studio/write.lock", true),
        "wx",
        0o600
      );
      const catalog = await this.catalog();
      if (keys !== null)
        check(
          Array.isArray(keys) &&
            keys.length > 0 &&
            keys.length <= 1000 &&
            new Set(keys).size === keys.length &&
            keys.every(k => /^[a-f0-9]{32}$/.test(k)),
          "Explicit unique selection required"
        );
      const matches = catalog.batches.filter(
        b => b.key === batch || b.id === batch
      );
      check(
        keys !== null || matches.length === 1,
        "Choose one batch folder; ambiguous batch identifiers cannot be combined"
      );
      const selected = catalog.items.filter(i =>
        keys !== null ? keys.includes(i.key) : i.batchKey === matches[0].key
      );
      check(
        selected.length ===
          (keys !== null ? keys.length : matches[0].sampleCount) &&
          selected.length &&
          selected.every(
            i => i.status === "approved" && i.contentKind === "real"
          ),
        "Entire batch must have real, independently reviewed data"
      );
      check(
        selected.every(
          i =>
            i.data.taxonomyVersion === selected[0].data.taxonomyVersion &&
            i.data.spatialPolicyVersion ===
              selected[0].data.spatialPolicyVersion
        ),
        "Selection policies differ"
      );
      check(
        new Set(selected.map(i => i.activeSha256 ?? i.sample.sha256)).size ===
          selected.length,
        "Duplicate media in batch"
      );
      const sources = [],
        samples = [];
      const similarityGroups = await releaseGroups(this, selected);
      const frozen = selected.some(
        i => i.sample.split !== null && i.sample.split !== undefined
      );
      check(
        !frozen ||
          selected.every(
            i =>
              ["train", "validation", "test"].includes(i.sample.split) &&
              JSON.stringify(i.data.splitPolicy) ===
                JSON.stringify(selected[0].data.splitPolicy)
          ),
        "Frozen split policies cannot be mixed or cleared"
      );
      const globalPath = (item, path) =>
        `${item.prefix ? item.prefix + "/" : ""}${path}`;
      const convert = async (item, value) => {
        const v = structuredClone(value);
        const walk = async o => {
          if (!o || typeof o !== "object") return;
          for (const [k, x] of Object.entries(o)) {
            if ((k === "evidence" || k === "calibrationEvidence") && x?.path) {
              x.path = globalPath(item, x.path);
              check(
                (await fileHash(await this.safe(x.path))) === x.sha256,
                "Evidence SHA mismatch"
              );
            } else if (typeof x === "object") await walk(x);
          }
        };
        await walk(v);
        return v;
      };
      for (const item of selected) {
        const s = await convert(item, item.sample);
        if (similarityGroups.has(item.key))
          s.leakageGroup = similarityGroups.get(item.key);
        s.path = item.activePath ?? globalPath(item, s.path);
        s.sha256 = item.activeSha256 ?? s.sha256;
        s.split = frozen ? item.sample.split : null;
        const before = item.sample.sourceId;
        for (const source of item.sources) {
          const copy = await convert(item, source);
          copy.id = `${item.key}-${source.id}`;
          if (source.id === before) s.sourceId = copy.id;
          sources.push(copy);
        }
        s.id = `${item.key}-${s.id}`;
        if (s.media?.video) {
          s.media.video.path = globalPath(item, s.media.video.path);
        }
        samples.push(s);
      }
      // All references are relative to the unchanged private storage root. Shared videos retain their hashes/groups.
      const base = selected[0].data;
      const motionSegments = [];
      const seen = new Set();
      for (const item of selected)
        for (const motion of item.motionSegments)
          if (!seen.has(motion.id)) {
            seen.add(motion.id);
            motionSegments.push(await convert(item, motion));
          }
      const snapshot = {
        ...base,
        id: `studio-${randomUUID()}`,
        annotationRevision: "studio-reviewed-" + new Date().toISOString(),
        sources,
        samples,
        motionSegments,
        studioProvenance: {
          exporter: actor.id,
          at: new Date().toISOString(),
          revisions: selected.map(i => ({
            key: i.key,
            version: i.version,
            baseHash: i.baseHash,
          })),
          note: "Human decisions preserved. Existing validation, split, export and training approvals still required.",
        },
      };
      if (!frozen) delete snapshot.splitPolicy;
      delete snapshot.files;
      delete snapshot.cocoPath;
      await validateDataset(snapshot, this.root, { requireSplit: frozen });
      // Existing CLI requires the manifest beside the data root. Keep it outside catalog discovery by naming it studio-reviewed.
      const path = `studio-reviewed-${randomUUID()}.json`;
      await writeFile(
        await this.safe(path, true),
        JSON.stringify(snapshot, null, 2) + "\n",
        { flag: "wx", mode: 0o600 }
      );
      return {
        path,
        status: "REVIEWED_SNAPSHOT_REQUIRES_FROZEN_SPLIT",
        samples: samples.length,
        trainingStarted: false,
        frozenSplitPreserved: frozen,
      };
    } finally {
      try {
        if (lock) {
          await lock.close();
          await unlink(resolve(this.root, ".studio/write.lock"));
        }
      } finally {
        this.busy = false;
      }
    }
  }
  async experiments() {
    const results = [];
    const visit = async (path, depth) => {
      if (depth > 3) return;
      for (const e of await readdir(path, { withFileTypes: true })) {
        if (e.isSymbolicLink()) continue;
        const p = resolve(path, e.name);
        if (e.isDirectory()) await visit(p, depth + 1);
        else if (
          /^(training-run|run-failure|gpu-check|.*report|.*comparison)\.json$/.test(
            e.name
          )
        ) {
          const rel = relative(this.root, p).split(sep).join("/");
          try {
            results.push({ path: rel, result: await this.json(rel) });
          } catch {
            results.push({ path: rel, error: "Unreadable result" });
          }
        }
      }
    };
    await visit(await this.safe("runs"), 0);
    return { trainingEnabled: false, results };
  }
}
