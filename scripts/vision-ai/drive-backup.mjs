// Explicit, encrypted, append-only backup through Drive for desktop.
// No OAuth tokens, network client, scheduler, sync/delete or automatic approvals.
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  lstat,
  rename,
  open,
  unlink,
  copyFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { outsideGit } from "./storage.mjs";
import { fileHash, hash, sha, requireValue as check } from "./common.mjs";
import { StudioWorkspace } from "./studio/workspace.mjs";
import { protect, privateWrite } from "./studio/identities.mjs";

const run = promisify(execFile),
  categories = [
    "images-real",
    "images-synthetic",
    "videos-real",
    "videos-synthetic",
    "datasets",
    "models",
    "results",
    "rights",
  ];
const forbidden = p =>
  p
    .split("/")
    .some(x =>
      /^(?:\.git|\.aws|\.codex|\.agents|keys|credentials|node_modules)$/i.test(
        x
      )
    ) ||
  /(?:^|\/)(?:\.env(?:\..*)?|.*(?:identities|password|credential|oauth|token|client.secret|service.account|private.key|id_rsa|id_ed25519).*|.*\.(?:pem|key|p12|pfx|conf))$/i.test(
    p
  ) ||
  (p.startsWith(".studio/") &&
    !/^\.studio\/derived\/[a-f0-9]{64}\.png$/.test(p));
const now = () => new Date().toISOString();
const fresh = t =>
  Number.isFinite(Date.parse(t)) &&
  Date.now() >= Date.parse(t) &&
  Date.now() - Date.parse(t) <= 15 * 60_000;
const fence = root => new StudioWorkspace(root); // Reuse existing safe/ensure, without treating a backup as a training dataset.
async function box(root) {
  const absolute = resolve(root);
  check(
    (await outsideGit(absolute)) === absolute,
    "Backup/source must not use a linked root or Git checkout"
  );
  const w = fence(absolute);
  await w.safe("config.json");
  return w;
}
async function put(w, path, value) {
  return privateWrite(
    w,
    path,
    Buffer.from(JSON.stringify(value, null, 2) + "\n")
  );
}
async function atomic(w, path, value) {
  const temp = path + "." + randomUUID() + ".tmp";
  await put(w, temp, value);
  await rename(await w.safe(temp), await w.safe(path, true));
}
async function age(w, args, keygen = false) {
  const c = await w.json("config.json"),
    tool = keygen ? c.keygen : c.age;
  check(
    tool && sha(tool.sha256) && (await fileHash(tool.path)) === tool.sha256,
    "Verified age tool missing or changed"
  );
  try {
    return await run(tool.path, args, {
      windowsHide: true,
      maxBuffer: 1_000_000,
      timeout: 300_000,
    });
  } catch {
    throw new Error(
      "age operation failed; no key material or tool output logged"
    );
  }
}
async function locked(w, action) {
  const path = await w.safe("backup.lock", true),
    fd = await open(path, "wx", 0o600);
  const attempt = randomUUID();
  try {
    await put(w, "journal/" + attempt + ".started.json", {
      at: now(),
      status: "started",
      sourceFilesDeleted: 0,
    });
    try {
      const result = await action();
      await put(w, "journal/" + attempt + ".completed.json", {
        at: now(),
        status: "completed",
        sourceFilesDeleted: 0,
        resultSha256: hash(JSON.stringify(result)),
      });
      return result;
    } catch (e) {
      await put(w, "journal/" + attempt + ".failed.json", {
        at: now(),
        status: "failed",
        sourceFilesDeleted: 0,
        reason:
          "Operation failed; inspect locally. No source deletion, no secret or external tool output logged.",
      });
      throw e;
    }
  } finally {
    await fd.close();
    await unlink(path);
  }
}
export async function initDriveBackup(root, accountEmail, tools) {
  check(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail),
    "Target account email required"
  );
  const absolute = resolve(root);
  check(
    (await outsideGit(absolute)) === absolute,
    "Backup root must be outside Git and links"
  );
  await mkdir(absolute);
  await protect(absolute, true);
  const w = fence(absolute);
  for (const p of [
    "keys",
    "plans",
    "packages",
    "journal",
    "outbox",
    "outbox/Basira-AI",
  ])
    await w.ensure(p);
  for (const c of categories) {
    await w.ensure("outbox/Basira-AI/" + c);
    await w.ensure("outbox/Basira-AI/" + c + "/objects");
  }
  await w.ensure("outbox/Basira-AI/datasets/snapshots");
  const config = {
    schemaVersion: 1,
    kind: "Basira-private-drive-backup",
    vaultId: randomUUID(),
    accountEmail: accountEmail.toLowerCase(),
    age: tools.age,
    keygen: tools.keygen,
    recipient: null,
    connected: false,
  };
  await put(w, "config.json", config);
  await put(w, "index.json", {});
  await age(w, ["-o", await w.safe("keys/recovery.agekey", true)], true);
  await protect(await w.safe("keys/recovery.agekey"));
  config.recipient = (
    await age(w, ["-y", await w.safe("keys/recovery.agekey")], true)
  ).stdout.trim();
  check(/^age1[0-9a-z]+$/.test(config.recipient), "Invalid age recipient");
  await atomic(w, "config.json", config);
  await put(w, "drive-target.pending.json", {
    schemaVersion: 1,
    vaultId: config.vaultId,
    accountEmail: config.accountEmail,
    driveRoot: "",
    confirmedBy: "",
    confirmedAt: "",
    accountCheckedInDriveUI: false,
    sharingRestricted: false,
    sourceNotAutoSynced: false,
    recoveryKeySavedOffline: false,
    quota: {
      source: "google-drive-storage-web-ui",
      checkedAt: "",
      freeBytes: null,
    },
  });
  return {
    status: "LOCAL_SETUP_ONLY_SIGNIN_PENDING",
    root: absolute,
    accountEmail: config.accountEmail,
    recoveryKeyPath: "keys/recovery.agekey",
    cloudFilesCreated: 0,
    realFilesUploaded: 0,
  };
}
export async function backupInventory(root) {
  check(
    (await outsideGit(root)) === resolve(root),
    "Source must be outside Git and links"
  );
  const w = fence(root),
    files = [],
    excluded = [];
  async function walk(dir = "") {
    for (const e of await readdir(dir ? await w.safe(dir) : w.root, {
      withFileTypes: true,
    })) {
      const p = dir ? dir + "/" + e.name : e.name;
      if (e.isSymbolicLink() || forbidden(p) || p === ".studio") {
        excluded.push({ path: p, reason: "secret_private_state_or_link" });
        continue;
      }
      const path = await w.safe(p);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile())
        files.push({
          path: p,
          bytes: (await lstat(path)).size,
          cloudApproval: "pending",
        });
    }
  }
  await walk();
  return {
    schemaVersion: 1,
    files,
    excluded,
    bytes: files.reduce((n, f) => n + f.bytes, 0),
    quotaChecked: false,
    cloudFilesCreated: 0,
  };
}
// Exactly reproducible public test bytes; a real image cannot bypass gates by
// changing its kind to synthetic-fixture.
const testBytes = {
  "synthetic-backup-fixture/README.txt": Buffer.from(
    "BASIRA SYNTHETIC BACKUP TEST ONLY. No training data or people.\n"
  ),
  "synthetic-backup-fixture/labels.json": Buffer.from(
    '{"kind":"synthetic-backup-test","objects":[],"trainingAllowed":false}\n'
  ),
  "synthetic-backup-fixture/pixel.png": Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64"
  ),
};
export async function makeBackupFixture(root) {
  check(
    (await outsideGit(root)) === resolve(root),
    "Fixture must be outside Git"
  );
  await mkdir(root);
  const w = fence(root);
  await w.ensure("synthetic-backup-fixture");
  const files = [];
  for (const [path, bytes] of Object.entries(testBytes)) {
    await privateWrite(w, path, bytes);
    files.push({
      path,
      sha256: hash(bytes),
      kind: "synthetic-fixture",
      category: path.endsWith(".png") ? "images-synthetic" : "datasets",
    });
  }
  return { schemaVersion: 1, files };
}
export async function planDriveBackup(backupRoot, sourceRoot, selection) {
  const w = await box(backupRoot),
    c = await w.json("config.json");
  check(
    (await outsideGit(sourceRoot)) === resolve(sourceRoot),
    "Source must be outside Git and links"
  );
  const source = fence(sourceRoot),
    files = [],
    blocked = [],
    seen = new Set();
  check(
    selection.schemaVersion === 1 &&
      Array.isArray(selection.files) &&
      selection.files.length <= 10000,
    "Explicit bounded file selection required"
  );
  for (const r of selection.files) {
    try {
      let sourceRightsEvidence = [];
      check(
        typeof r.path === "string" && !forbidden(r.path) && !seen.has(r.path),
        "Secret, duplicate or forbidden path"
      );
      seen.add(r.path);
      const p = await source.safe(r.path);
      check(
        (await lstat(p)).isFile() &&
          sha(r.sha256) &&
          (await fileHash(p)) === r.sha256,
        "Source SHA/regular file check failed"
      );
      check(categories.includes(r.category), "Unknown backup category");
      if (/\.(?:png|jpe?g|webp|mp4|webm|mov|mkv)$/i.test(r.path))
        check(
          ["real", "synthetic", "synthetic-fixture"].includes(r.kind),
          "Media requires real/synthetic provenance"
        );
      if (r.kind === "model")
        check(r.category === "models", "Model backup category required");
      if (/\.(?:png|jpe?g|webp)$/i.test(r.path))
        check(
          r.category ===
            (r.kind === "real" ? "images-real" : "images-synthetic"),
          "Real/synthetic image separation required"
        );
      if (/\.(?:mp4|webm|mov|mkv)$/i.test(r.path))
        check(
          r.category ===
            (r.kind === "real" ? "videos-real" : "videos-synthetic"),
          "Real/synthetic video separation required"
        );
      if (r.kind === "synthetic-fixture")
        check(
          testBytes[r.path] && hash(testBytes[r.path]) === r.sha256,
          "Not a reproducible backup fixture"
        );
      else {
        check(
          ["real", "synthetic", "metadata", "model"].includes(r.kind),
          "Explicit content kind required"
        );
        check(
          Array.isArray(r.preparedBy) && r.preparedBy.length > 0,
          "Preparation contributors required"
        );
        for (const key of ["rights", "privacy"]) {
          const review = r.cloudReview?.[key];
          check(
            review?.status === "approved" &&
              review.cloudStorageAllowed === true &&
              review.fileSha256 === r.sha256 &&
              typeof review.reviewer === "string" &&
              review.reviewer.trim() &&
              !r.preparedBy.includes(review.reviewer) &&
              Number.isFinite(Date.parse(review.at)) &&
              review.reason?.trim()?.length >= 3,
            "Independent per-file cloud rights/privacy review is pending"
          );
          const e = review.evidence;
          check(
            e &&
              sha(e.sha256) &&
              (await fileHash(await source.safe(e.path))) === e.sha256,
            "Cloud permission evidence missing or changed"
          );
        }
        if (/\.(?:png|jpe?g|webp)$/i.test(r.path)) {
          const dataset = await new StudioWorkspace(sourceRoot).init(),
            item = await dataset.item(r.studioKey);
          check(
            item.contentKind === r.kind &&
              (item.activePath ?? item.prefix + "/" + item.sample.path) ===
                r.path &&
              (item.activeSha256 ?? item.sample.sha256) === r.sha256 &&
              item.sample.privacy?.status === "approved" &&
              item.sources.every(s => s.rightsReview?.status === "approved"),
            "Studio source rights/privacy are pending or image is not the reviewed active version"
          );
          const contributors = await dataset.contributors(item);
          await dataset.sourceEvidence(item);
          sourceRightsEvidence = item.sources.map(s => ({
            path: item.prefix + "/" + s.rightsReview.evidence.path,
            sha256: s.rightsReview.evidence.sha256,
          }));
          check(
            !contributors.has(r.cloudReview.rights.reviewer) &&
              !contributors.has(r.cloudReview.privacy.reviewer),
            "A previous contributor cannot approve their own cloud transfer"
          );
        }
        if (/\.(?:mp4|webm|mov|mkv)$/i.test(r.path))
          check(
            r.cloudReview.privacy.coverage === "all_frames_and_audio",
            "Whole-video and audio privacy review required"
          );
        if (
          !/\.(?:png|jpe?g|webp|mp4|webm|mov|mkv|pt|pth|onnx|tflite)$/i.test(
            r.path
          )
        ) {
          check(
            (await lstat(p)).size < 5_000_000,
            "Large non-media file needs separate secret review"
          );
          check(
            !/AGE-SECRET-KEY-|-----BEGIN .*PRIVATE KEY|["'](?:password|passwordHash|refresh_token|access_token|client_secret)["']\s*:|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,}/i.test(
              await readFile(p, "utf8")
            ),
            "Secret content cannot be backed up"
          );
        }
      }
      files.push({ ...r, sourceRightsEvidence, bytes: (await lstat(p)).size });
    } catch (e) {
      blocked.push({ path: r.path, reason: e.message });
    }
  }
  // Keep provenance recoverable without silently adding unreviewed evidence.
  let removed;
  do {
    removed = false;
    for (const f of [...files]) {
      if (f.kind === "synthetic-fixture") continue;
      const dependencies = [
        ...f.sourceRightsEvidence,
        f.cloudReview.rights.evidence,
        f.cloudReview.privacy.evidence,
      ];
      if (
        dependencies.some(
          e => !files.some(x => x.path === e.path && x.sha256 === e.sha256)
        )
      ) {
        blocked.push({
          path: f.path,
          reason:
            "Reviewed rights/privacy/source evidence must also be explicitly selected and eligible",
        });
        files.splice(files.indexOf(f), 1);
        removed = true;
      }
    }
  } while (removed);
  const plan = {
    schemaVersion: 1,
    id: randomUUID(),
    at: now(),
    sourceRoot: source.root,
    vaultId: c.vaultId,
    accountEmail: c.accountEmail,
    recipient: c.recipient,
    files,
    blocked,
    plainBytes: files.reduce((n, f) => n + f.bytes, 0),
    approvedForCloudTransfer: false,
  };
  await put(w, "plans/" + plan.id + ".json", plan);
  return { plan, planSha256: hash(JSON.stringify(plan)) };
}
export async function prepareDriveBackup(root, planPath) {
  const w = await box(root);
  return locked(w, async () => {
    const c = await w.json("config.json"),
      plan = await w.json(planPath),
      source = fence(plan.sourceRoot),
      index = await w.json("index.json");
    check(
      plan.vaultId === c.vaultId &&
        plan.accountEmail === c.accountEmail &&
        plan.recipient === c.recipient &&
        plan.files.length,
      "Plan binding mismatch or no eligible files"
    );
    // Re-evaluate rights, privacy, evidence, and original SHA before encryption.
    const checked = await planDriveBackup(root, plan.sourceRoot, {
      schemaVersion: 1,
      files: plan.files,
    });
    check(
      checked.plan.blocked.length === 0,
      "Preparation gates changed; create a new reviewed plan"
    );
    const manifest = {
        schemaVersion: 1,
        snapshotId: randomUUID(),
        at: now(),
        planSha256: hash(JSON.stringify(plan)),
        accountEmail: c.accountEmail,
        vaultId: c.vaultId,
        files: [],
      },
      transferFiles = [];
    for (const f of plan.files) {
      const cache = hash(c.recipient) + ":" + f.category + ":" + f.sha256;
      let object = index[cache];
      if (object)
        check(
          (await fileHash(await w.safe(object.path))) === object.sha256,
          "Cached encrypted object changed"
        );
      else {
        const tmp =
          "outbox/Basira-AI/" +
          f.category +
          "/objects/" +
          randomUUID() +
          ".tmp";
        await age(w, [
          "-r",
          c.recipient,
          "-o",
          await w.safe(tmp, true),
          await source.safe(f.path),
        ]);
        check(
          (await fileHash(await source.safe(f.path))) === f.sha256,
          "Source changed during encryption"
        );
        const cipherSha = await fileHash(await w.safe(tmp)),
          path =
            "outbox/Basira-AI/" + f.category + "/objects/" + cipherSha + ".age";
        await rename(await w.safe(tmp), await w.safe(path, true));
        object = {
          path,
          sha256: cipherSha,
          bytes: (await lstat(await w.safe(path))).size,
        };
        index[cache] = object;
      }
      manifest.files.push({
        path: f.path,
        category: f.category,
        kind: f.kind,
        plainSha256: f.sha256,
        plainBytes: f.bytes,
        cloudReview: f.cloudReview ?? null,
        preparedBy: f.preparedBy ?? [],
        sourceRightsEvidence: f.sourceRightsEvidence,
        object: object.path.replace("outbox/Basira-AI/", ""),
        cipherSha256: object.sha256,
      });
      if (!transferFiles.some(x => x.path === object.path))
        transferFiles.push(object);
    }
    const privateManifest = "packages/" + manifest.snapshotId + ".private.json";
    await put(w, privateManifest, manifest);
    const path =
      "outbox/Basira-AI/datasets/snapshots/" + manifest.snapshotId + ".age";
    await age(w, [
      "-r",
      c.recipient,
      "-o",
      await w.safe(path, true),
      await w.safe(privateManifest),
    ]);
    const encryptedManifest = {
      path,
      sha256: await fileHash(await w.safe(path)),
      bytes: (await lstat(await w.safe(path))).size,
    };
    transferFiles.push(encryptedManifest);
    const pack = {
      schemaVersion: 1,
      id: manifest.snapshotId,
      planPath,
      planSha256: manifest.planSha256,
      accountEmail: c.accountEmail,
      vaultId: c.vaultId,
      encryptedManifest,
      files: transferFiles,
      totalBytes: transferFiles.reduce((n, f) => n + f.bytes, 0),
      encryption: "age-X25519",
      cloudUploadPerformed: false,
    };
    await put(w, "packages/" + pack.id + ".json", pack);
    await atomic(w, "index.json", index);
    await put(w, "packages/" + pack.id + ".approval.pending.json", {
      status: "pending",
      packageSha256: hash(JSON.stringify(pack)),
      accountEmail: c.accountEmail,
      reviewer: "",
      at: "",
      reason: "",
    });
    return {
      packagePath: "packages/" + pack.id + ".json",
      snapshot: pack.id,
      bytes: pack.totalBytes,
      cloudUploadPerformed: false,
    };
  });
}
function validateTarget(c, t) {
  check(
    t.vaultId === c.vaultId &&
      t.accountEmail === c.accountEmail &&
      t.accountCheckedInDriveUI === true &&
      t.sharingRestricted === true &&
      t.sourceNotAutoSynced === true &&
      t.recoveryKeySavedOffline === true &&
      t.confirmedBy?.trim() &&
      fresh(t.confirmedAt),
    "Target account, private sharing, source isolation and offline recovery must be explicitly checked in Drive UI within 15 minutes"
  );
  check(
    t.quota?.source === "google-drive-storage-web-ui" &&
      fresh(t.quota.checkedAt) &&
      Number.isSafeInteger(t.quota.freeBytes) &&
      t.quota.freeBytes >= 0,
    "Fresh cloud quota required; mapped drive/disk free space is not Google quota"
  );
}
export async function copyDriveBackup(root, packagePath, target, approval) {
  const w = await box(root);
  return locked(w, async () => {
    const c = await w.json("config.json"),
      pack = await w.json(packagePath),
      plan = await w.json(pack.planPath);
    validateTarget(c, target);
    check(
      pack.vaultId === c.vaultId &&
        pack.accountEmail === c.accountEmail &&
        approval.status === "approved" &&
        approval.packageSha256 === hash(JSON.stringify(pack)) &&
        approval.accountEmail === c.accountEmail &&
        approval.reviewer?.trim() &&
        fresh(approval.at) &&
        approval.reason?.trim()?.length >= 3,
      "Explicit owner approval must bind exact encrypted file list and account"
    );
    check(
      hash(JSON.stringify(plan)) === pack.planSha256,
      "Original reviewed plan changed"
    );
    const recheck = await planDriveBackup(root, plan.sourceRoot, {
      schemaVersion: 1,
      files: plan.files,
    });
    check(!recheck.plan.blocked.length, "Source or cloud approvals changed");
    const driveRoot = resolve(target.driveRoot);
    check(
      (await outsideGit(driveRoot)) === driveRoot &&
        ![w.root, plan.sourceRoot].some(
          p =>
            driveRoot === p ||
            driveRoot.startsWith(p + sep) ||
            p.startsWith(driveRoot + sep)
        ),
      "Drive root must be separate from source, backup keys and Git"
    );
    const drive = fence(driveRoot);
    let needed = 0;
    for (const f of pack.files) {
      check(
        /^outbox\/Basira-AI\/(?:images-real|images-synthetic|videos-real|videos-synthetic|datasets|models|results|rights)\/(?:objects\/[a-f0-9]{64}|snapshots\/[a-f0-9-]{36})\.age$/.test(
          f.path
        ) &&
          sha(f.sha256) &&
          (await fileHash(await w.safe(f.path))) === f.sha256 &&
          (await lstat(await w.safe(f.path))).size === f.bytes,
        "Encrypted package file changed, size incorrect or path invalid"
      );
      const p = f.path.slice("outbox/".length);
      try {
        check(
          (await fileHash(await drive.safe(p))) === f.sha256,
          "Destination conflict; never overwrite"
        );
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        needed += f.bytes;
      }
    }
    check(
      needed + 100 * 1024 * 1024 <= target.quota.freeBytes,
      "Insufficient confirmed Google quota including 100 MiB reserve"
    );
    await drive.ensure("Basira-AI");
    const marker = "Basira-AI/basira-vault.json";
    try {
      check(
        (await drive.json(marker)).vaultId === c.vaultId,
        "Wrong destination vault"
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      await writeFile(
        await drive.safe(marker, true),
        JSON.stringify({ schemaVersion: 1, vaultId: c.vaultId }),
        { flag: "wx" }
      );
    }
    for (const category of categories) {
      await drive.ensure("Basira-AI/" + category);
      await drive.ensure("Basira-AI/" + category + "/objects");
    }
    await drive.ensure("Basira-AI/datasets/snapshots");
    let copied = 0,
      skipped = 0;
    for (const f of pack.files) {
      const p = f.path.slice("outbox/".length);
      try {
        await drive.safe(p);
        skipped++;
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        await copyFile(
          await w.safe(f.path),
          await drive.safe(p, true),
          constants.COPYFILE_EXCL
        );
        const fd = await open(await drive.safe(p), "r+");
        try {
          await fd.sync();
        } finally {
          await fd.close();
        }
        copied++;
      }
      check(
        (await fileHash(await drive.safe(p))) === f.sha256,
        "Destination SHA mismatch; inspect partial encrypted copy"
      );
    }
    const receipt = {
      at: now(),
      snapshot: pack.id,
      accountEmail: c.accountEmail,
      copied,
      skipped,
      additionalBytes: needed,
      sourceFilesDeleted: 0,
      driveFilesystemCopyPerformed: true,
      verificationScope:
        "Drive-for-desktop filesystem readback; cloud completion and fresh independent download still require verification",
      cloudDurabilityVerified: false,
    };
    await put(w, "journal/" + randomUUID() + ".json", receipt);
    return receipt;
  });
}
export async function restoreDriveBackup(
  root,
  encryptedManifest,
  manifestSha256,
  vaultRoot,
  output
) {
  const w = await box(root),
    vault = fence(await outsideGit(vaultRoot));
  check(
    sha(manifestSha256) &&
      (await fileHash(await vault.safe(encryptedManifest))) === manifestSha256,
    "Encrypted manifest SHA mismatch"
  );
  check(
    (await lstat(await vault.safe(encryptedManifest))).size < 20_000_000,
    "Encrypted restore manifest too large"
  );
  const local = "packages/restore-" + randomUUID() + ".private.json";
  await age(w, [
    "-d",
    "-i",
    await w.safe("keys/recovery.agekey"),
    "-o",
    await w.safe(local, true),
    await vault.safe(encryptedManifest),
  ]);
  const m = await w.json(local),
    c = await w.json("config.json");
  check(
    m.schemaVersion === 1 &&
      m.vaultId === c.vaultId &&
      Array.isArray(m.files) &&
      m.files.length <= 10000,
    "Restore manifest invalid"
  );
  const driveParent = dirname(resolve(vaultRoot)),
    restored = resolve(output);
  check(
    restored !== driveParent && !restored.startsWith(driveParent + sep),
    "Never restore plaintext inside the Drive/sync tree"
  );
  check(
    (await outsideGit(output)) === resolve(output),
    "Restore root must be outside Git/links"
  );
  await mkdir(output);
  await protect(output, true);
  const dest = fence(output),
    seen = new Set();
  for (const f of m.files) {
    check(
      categories.includes(f.category) &&
        !forbidden(f.path) &&
        sha(f.plainSha256) &&
        sha(f.cipherSha256) &&
        !seen.has(f.path),
      "Invalid restore entry"
    );
    seen.add(f.path);
    await dest.safe(f.path, true).catch(e => {
      if (e.code !== "ENOENT") throw e;
    });
    check(
      (await fileHash(await vault.safe(f.object))) === f.cipherSha256,
      "Encrypted object SHA mismatch"
    );
    const parts = f.path.split("/");
    for (let n = 1; n < parts.length; n++)
      await dest.ensure(parts.slice(0, n).join("/"));
    await age(w, [
      "-d",
      "-i",
      await w.safe("keys/recovery.agekey"),
      "-o",
      await dest.safe(f.path, true),
      await vault.safe(f.object),
    ]);
    check(
      (await fileHash(await dest.safe(f.path))) === f.plainSha256,
      "Restored original SHA mismatch"
    );
  }
  const receipt = {
    at: now(),
    snapshot: m.snapshotId,
    restored: m.files.length,
    originalSha256Verified: true,
    output: resolve(output),
    cloudDurabilityVerified: false,
  };
  await put(w, "journal/restore-" + randomUUID() + ".json", receipt);
  return receipt;
}
