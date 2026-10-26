import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  initDriveBackup,
  makeBackupFixture,
  planDriveBackup,
  prepareDriveBackup,
  copyDriveBackup,
  restoreDriveBackup,
  backupInventory,
} from "./drive-backup.mjs";
import { hash, fileHash } from "./common.mjs";
const toolsPath = process.env.BASIRA_BACKUP_TEST_TOOLS;
async function setup(t, encrypted = false) {
  const temp = await mkdtemp(resolve(tmpdir(), "basira-backup-synthetic-")),
    backup = resolve(temp, "backup"),
    source = resolve(temp, "source"),
    drive = resolve(temp, "drive");
  t.after(async () => {
    assert.ok(backup.startsWith(temp));
    await rm(temp, { recursive: true, force: true });
  });
  await mkdir(drive);
  if (encrypted)
    await initDriveBackup(backup, "fixture@example.invalid", {
      ...JSON.parse(await readFile(toolsPath)),
      accountEmail: "must-not-override@example.invalid",
      vaultId: "must-not-override",
    });
  else {
    await mkdir(backup);
    for (const dir of ["plans", "packages", "journal"])
      await mkdir(resolve(backup, dir));
    await writeFile(
      resolve(backup, "config.json"),
      JSON.stringify({
        vaultId: randomUUID(),
        accountEmail: "fixture@example.invalid",
        recipient: "age1test-not-used-for-encryption",
      })
    );
    await writeFile(resolve(backup, "index.json"), "{}");
  }
  const selection = await makeBackupFixture(source),
    result = await planDriveBackup(backup, source, selection);
  return {
    temp,
    backup,
    source,
    drive,
    selection,
    plan: result.plan,
    planPath: "plans/" + result.plan.id + ".json",
  };
}
const target = (drive, c) => ({
  vaultId: c.vaultId,
  accountEmail: c.accountEmail,
  driveRoot: drive,
  confirmedBy: "fictional-test-operator-not-a-real-reviewer",
  confirmedAt: new Date().toISOString(),
  accountCheckedInDriveUI: true,
  sharingRestricted: true,
  sourceNotAutoSynced: true,
  recoveryKeySavedOffline: true,
  quota: {
    source: "google-drive-storage-web-ui",
    checkedAt: new Date().toISOString(),
    freeBytes: 1_000_000_000,
  },
});
const approval = pack => ({
  status: "approved",
  packageSha256: hash(JSON.stringify(pack)),
  accountEmail: pack.accountEmail,
  reviewer: "fictional-test-operator-not-a-real-reviewer",
  at: new Date().toISOString(),
  reason:
    "Fictional synthetic-only test approval, no real human/cloud verification",
});

test(
  "encrypted synthetic roundtrip, incremental copies, old snapshot restore and corruption rejection",
  { skip: !toolsPath },
  async t => {
    const s = await setup(t, true),
      prepared = await prepareDriveBackup(s.backup, s.planPath),
      pack = JSON.parse(
        await readFile(resolve(s.backup, prepared.packagePath))
      ),
      c = JSON.parse(await readFile(resolve(s.backup, "config.json"))),
      ta = target(s.drive, c);
    assert.equal(c.accountEmail, "fixture@example.invalid");
    assert.match(c.vaultId, /^[a-f0-9-]{36}$/);
    assert.equal(s.plan.files.length, 3);
    assert.equal(prepared.cloudUploadPerformed, false);
    const first = await copyDriveBackup(
      s.backup,
      prepared.packagePath,
      ta,
      approval(pack)
    );
    assert.equal(first.copied, 4);
    assert.equal(first.sourceFilesDeleted, 0);
    assert.equal(first.cloudDurabilityVerified, false);
    assert.ok(
      (await readFile(resolve(s.backup, pack.files[0].path)))
        .subarray(0, 24)
        .toString()
        .startsWith("age-encryption.org/v1")
    );
    const again = await copyDriveBackup(
      s.backup,
      prepared.packagePath,
      ta,
      approval(pack)
    );
    assert.equal(again.copied, 0);
    assert.equal(again.skipped, 4);
    const second = await prepareDriveBackup(s.backup, s.planPath),
      pack2 = JSON.parse(await readFile(resolve(s.backup, second.packagePath)));
    assert.deepEqual(pack.files.slice(0, 3), pack2.files.slice(0, 3));
    assert.equal(
      (await copyDriveBackup(s.backup, second.packagePath, ta, approval(pack2)))
        .copied,
      1
    );
    const vault = resolve(s.drive, "Basira-AI"),
      manifest = pack.encryptedManifest.path.replace("outbox/Basira-AI/", "");
    const restored = resolve(s.temp, "restored"),
      receipt = await restoreDriveBackup(
        s.backup,
        manifest,
        pack.encryptedManifest.sha256,
        vault,
        restored
      );
    assert.equal(receipt.restored, 3);
    for (const f of s.selection.files)
      assert.equal(await fileHash(resolve(restored, f.path)), f.sha256);
    await assert.rejects(
      restoreDriveBackup(
        s.backup,
        manifest,
        pack.encryptedManifest.sha256,
        vault,
        resolve(s.drive, "plaintext-unsafe")
      ),
      /Never restore plaintext/
    );
    await rm(resolve(s.source, s.selection.files[0].path));
    assert.equal(
      (
        await restoreDriveBackup(
          s.backup,
          manifest,
          pack.encryptedManifest.sha256,
          vault,
          resolve(s.temp, "restored-after-source-deletion")
        )
      ).restored,
      3
    );
    const encryptedObject = resolve(
      s.drive,
      pack.files[0].path.replace("outbox/", "")
    );
    await writeFile(
      encryptedObject,
      Buffer.concat([await readFile(encryptedObject), Buffer.from("corrupt")])
    );
    await assert.rejects(
      restoreDriveBackup(
        s.backup,
        manifest,
        pack.encryptedManifest.sha256,
        vault,
        resolve(s.temp, "corrupt-restore")
      ),
      /Encrypted object SHA/
    );
  }
);

test(
  "owner/file list, account, recent cloud quota and Drive isolation gates fail closed",
  { skip: !toolsPath },
  async t => {
    const s = await setup(t, true),
      prepared = await prepareDriveBackup(s.backup, s.planPath),
      pack = JSON.parse(
        await readFile(resolve(s.backup, prepared.packagePath))
      ),
      c = JSON.parse(await readFile(resolve(s.backup, "config.json"))),
      ta = target(s.drive, c),
      ok = approval(pack);
    for (const [change, pattern] of [
      [{ accountEmail: "wrong@example.invalid" }, /Target account/],
      [{ sharingRestricted: false }, /Target account/],
      [{ recoveryKeySavedOffline: false }, /Target account/],
      [{ quota: { ...ta.quota, freeBytes: 10 } }, /Insufficient/],
      [
        { quota: { ...ta.quota, checkedAt: "2000-01-01" } },
        /Fresh cloud quota/,
      ],
      [{ driveRoot: s.source }, /Drive root must/],
    ])
      await assert.rejects(
        copyDriveBackup(
          s.backup,
          prepared.packagePath,
          { ...ta, ...change },
          ok
        ),
        pattern
      );
    await assert.rejects(
      copyDriveBackup(s.backup, prepared.packagePath, ta, {
        ...ok,
        status: "pending",
      }),
      /Explicit owner approval/
    );
    await assert.rejects(
      copyDriveBackup(s.backup, prepared.packagePath, ta, {
        ...ok,
        packageSha256: "0".repeat(64),
      }),
      /Explicit owner approval/
    );
    assert.deepEqual(await readdir(s.drive), []);
  }
);

test("passwords, Studio records, keys and links are excluded; a real image cannot masquerade as a fixture", async t => {
  const s = await setup(t);
  await mkdir(resolve(s.source, ".studio"));
  await writeFile(
    resolve(s.source, ".studio/identities.json"),
    '{"passwordHash":"fictional"}'
  );
  await writeFile(resolve(s.source, ".env"), "fictional-only-key");
  await mkdir(resolve(s.source, "keys"));
  await writeFile(resolve(s.source, "keys/recovery.agekey"), "FICTIONAL");
  const linked = resolve(s.temp, "outside");
  await mkdir(linked);
  await writeFile(resolve(linked, "dummy.txt"), "synthetic");
  await symlink(
    linked,
    resolve(s.source, "linked"),
    process.platform === "win32" ? "junction" : "dir"
  );
  const inv = await backupInventory(s.source);
  assert.equal(inv.files.length, 3);
  assert.ok(inv.excluded.length >= 4);
  const selection = {
    schemaVersion: 1,
    files: [
      ...s.selection.files,
      {
        path: ".studio/identities.json",
        sha256: "0".repeat(64),
        kind: "synthetic-fixture",
        category: "datasets",
      },
      {
        path: "linked/dummy.txt",
        sha256: hash("synthetic"),
        kind: "synthetic-fixture",
        category: "datasets",
      },
    ],
  };
  const result = await planDriveBackup(s.backup, s.source, selection);
  assert.equal(result.plan.files.length, 3);
  assert.equal(result.plan.blocked.length, 2);
  const pixel = s.selection.files[2];
  await writeFile(
    resolve(s.source, pixel.path),
    Buffer.from("different bytes, not generated by backup fixture")
  );
  const fake = await planDriveBackup(s.backup, s.source, {
    schemaVersion: 1,
    files: [
      { ...pixel, sha256: await fileHash(resolve(s.source, pixel.path)) },
    ],
  });
  assert.equal(fake.plan.files.length, 0);
  assert.match(fake.plan.blocked[0].reason, /Not a reproducible/);
});

test("pending permissions, self review, altered evidence and mixed real/synthetic categories block preparation", async t => {
  const s = await setup(t),
    f = s.selection.files[0],
    original = { ...f, kind: "metadata", preparedBy: ["fixture-preparer"] };
  const pending = await planDriveBackup(s.backup, s.source, {
    schemaVersion: 1,
    files: [original],
  });
  assert.equal(pending.plan.files.length, 0);
  assert.match(pending.plan.blocked[0].reason, /pending/);
  const ev = { path: f.path, sha256: f.sha256 },
    rights = {
      status: "approved",
      cloudStorageAllowed: true,
      fileSha256: f.sha256,
      reviewer: "fixture-preparer",
      at: new Date().toISOString(),
      reason: "Fictional test only",
      evidence: ev,
    };
  const self = await planDriveBackup(s.backup, s.source, {
    schemaVersion: 1,
    files: [{ ...original, cloudReview: { rights, privacy: rights } }],
  });
  assert.equal(self.plan.files.length, 0);
  const changed = {
    ...rights,
    reviewer: "independent-fixture",
    evidence: { ...ev, sha256: "0".repeat(64) },
  };
  assert.equal(
    (
      await planDriveBackup(s.backup, s.source, {
        schemaVersion: 1,
        files: [
          { ...original, cloudReview: { rights: changed, privacy: changed } },
        ],
      })
    ).plan.files.length,
    0
  );
  assert.equal(
    (
      await planDriveBackup(s.backup, s.source, {
        schemaVersion: 1,
        files: [{ ...s.selection.files[2], category: "images-real" }],
      })
    ).plan.files.length,
    0
  );
});

test("changed source bytes invalidate a previously prepared selection without any upload", async t => {
  const s = await setup(t);
  await writeFile(
    resolve(s.source, s.selection.files[0].path),
    "changed synthetic source"
  );
  await assert.rejects(
    prepareDriveBackup(s.backup, s.planPath),
    /gates changed/
  );
  assert.deepEqual(await readdir(s.drive), []);
  assert.ok(!(await readdir(s.backup)).includes("backup.lock"));
});

test("reviewed metadata retains explicitly reviewed evidence; missing provenance blocks its dependents", async t => {
  const s = await setup(t),
    proof = s.selection.files[0],
    data = s.selection.files[1];
  const reviewed = (f, evidence) => ({
    ...f,
    kind: "metadata",
    category: "rights",
    preparedBy: ["fictional-preparer"],
    cloudReview: Object.fromEntries(
      ["rights", "privacy"].map(key => [
        key,
        {
          status: "approved",
          cloudStorageAllowed: true,
          fileSha256: f.sha256,
          reviewer: "independent-fictional-reviewer",
          at: new Date().toISOString(),
          reason: "Fictional approval in synthetic-only test",
          evidence: { path: evidence.path, sha256: evidence.sha256 },
        },
      ])
    ),
  });
  const missing = await planDriveBackup(s.backup, s.source, {
    schemaVersion: 1,
    files: [reviewed(data, proof)],
  });
  assert.equal(missing.plan.files.length, 0);
  assert.match(
    missing.plan.blocked[0].reason,
    /evidence must also be explicitly selected/
  );
  const complete = await planDriveBackup(s.backup, s.source, {
    schemaVersion: 1,
    files: [reviewed(data, proof), reviewed(proof, proof)],
  });
  assert.equal(complete.plan.files.length, 2);
  assert.equal(complete.plan.blocked.length, 0);
});
