import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  symlink,
  mkdir,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import http from "node:http";
import sharp from "sharp";
import { fixture } from "./fixture.mjs";
import { createStudio } from "./server.mjs";
import { StudioWorkspace } from "./workspace.mjs";
import { validateDataset, assignSplits } from "../data.mjs";
import { fileHash } from "../common.mjs";
import { transferPlan } from "../storage.mjs";

test("incoming and collection folders sharing an ID remain separate export choices", async t => {
  const { root, w, item } = await setup(t, 1);
  const target = resolve(root, "incoming/mirror");
  await mkdir(target);
  await mkdir(resolve(target, "images"));
  await mkdir(resolve(target, "rights"));
  for (const path of [
    "dataset.review.pending.json",
    "images/demo-001.png",
    "rights/team.txt",
  ])
    await copyFile(resolve(root, "incoming/demo", path), resolve(target, path));
  const c = await w.catalog();
  assert.equal(c.items.length, 2);
  assert.equal(new Set(c.batches.map(b => b.key)).size, 2);
  await assert.rejects(w.exportBatch(item.batch, reviewer), /ambiguous batch/);
  await assert.rejects(
    w.exportBatch(c.batches[0].key, reviewer),
    /Entire batch/
  );
});

test("local account credentials never enter future cloud transfer inventories", async t => {
  const { root } = await setup(t, 1);
  await assert.rejects(
    transferPlan(root, "gcs", "synthetic-private-bucket"),
    /credentials cannot/
  );
});

const editor = {
    id: "editor",
    roles: ["annotator", "rights", "privacy", "labels"],
  },
  reviewer = { id: "reviewer", roles: ["rights", "privacy", "labels"] };
async function setup(t, n = 3) {
  const temp = await mkdtemp(resolve(tmpdir(), "basira-studio-"));
  const root = resolve(temp, "data");
  await fixture(root, { images: n });
  t.after(() => rm(temp, { recursive: true, force: true }));
  const w = await new StudioWorkspace(root).init();
  const c = await w.catalog();
  return { root, w, item: c.items[0], c };
}
const edit = i => ({
  action: "labels",
  version: i.version,
  reason: "synthetic correction",
  objects: structuredClone(i.sample.annotation.objects),
});

test("indexes existing drafts; incomplete and class coverage do not mean training approval", async t => {
  const { c, root } = await setup(t, 6);
  assert.equal(c.items.length, 6);
  assert.equal(c.summary.approved, 0);
  assert.equal(Object.keys(c.summary.classCounts).length, 6);
  await assert.rejects(
    validateDataset(c.items[0].data, resolve(root, "incoming/demo")),
    /synthetic/
  );
});
test("actual new imported directory appears without generating HTML", async t => {
  const { w, root } = await setup(t);
  await mkdir(resolve(root, "incoming/new"));
  await mkdir(resolve(root, "incoming/new/images"));
  await copyFile(
    resolve(root, "incoming/demo/images/demo-001.png"),
    resolve(root, "incoming/new/images/new.png")
  );
  const data = JSON.parse(
    await readFile(resolve(root, "incoming/demo/dataset.review.pending.json"))
  );
  data.id = "second-synthetic-batch";
  data.samples = [
    { ...data.samples[0], id: "newly-imported", path: "images/new.png" },
  ];
  await writeFile(
    resolve(root, "incoming/new/dataset.draft.json"),
    JSON.stringify(data)
  );
  assert.equal((await w.catalog()).summary.images, 4);
});
test("path traversal, absolute paths and junctions are rejected", async t => {
  const { w, root } = await setup(t);
  for (const p of [
    "../outside",
    "C:/secret",
    "/etc/passwd",
    "images\\file.png",
    ".studio/../storage.json",
  ])
    await assert.rejects(w.safe(p), /Invalid data path/);
  const outside = resolve(root, "../outside");
  await mkdir(outside);
  await symlink(
    outside,
    resolve(root, "incoming/junction"),
    process.platform === "win32" ? "junction" : "dir"
  );
  await assert.rejects(w.safe("incoming/junction"), /Links|Reparse/);
  assert.ok((await w.catalog()).issues.length);
});
test("role and independent-review gates cannot be bypassed by self-approval", async t => {
  const { w, item } = await setup(t);
  await assert.rejects(w.change(item.key, edit(item), reviewer), /Role/);
  await w.change(item.key, edit(item), editor);
  await assert.rejects(
    w.change(
      item.key,
      {
        action: "review",
        kind: "labels",
        status: "approved",
        version: 1,
        reason: "synthetic self review",
        exhaustive: true,
      },
      editor
    ),
    /Independent/
  );
});
test("version chain records human decisions; edits revoke all approvals without modifying originals", async t => {
  const { w, item, root } = await setup(t);
  const original = await fileHash(await w.mediaPath(item));
  await w.change(item.key, edit(item), editor);
  for (const [n, kind] of ["rights", "privacy", "labels"].entries())
    await w.change(
      item.key,
      {
        action: "review",
        kind,
        status: "approved",
        version: n + 1,
        reason: "independent synthetic review",
        exhaustive: true,
        metadataStripped: true,
        faces: "absent",
        plates: "absent",
        personalText: "absent",
      },
      reviewer
    );
  const approved = await w.item(item.key);
  assert.equal(approved.status, "approved");
  await assert.rejects(w.exportBatch(item.batch, reviewer), /Entire batch/);
  await w.change(item.key, edit(approved), editor);
  const changed = await w.item(item.key);
  assert.equal(changed.status, "pending");
  assert.ok(changed.sources.every(s => !s.trainingAllowed));
  assert.equal(changed.sample.privacy.status, "pending");
  const history = await w.revisions(item.key);
  assert.equal(history.length, 5);
  const latest = await w.json(history[4]);
  assert.equal(latest.parentSha256, await fileHash(await w.safe(history[3])));
  assert.equal(latest.actor, "editor");
  assert.equal(await fileHash(await w.mediaPath(item)), original);
  assert.equal(
    JSON.parse(
      await readFile(resolve(root, "incoming/demo/dataset.review.pending.json"))
    ).samples[0].annotation.annotator,
    "fixture-author"
  );
});
test("stale edits and changed input manifests fail closed", async t => {
  const { w, item, root } = await setup(t);
  await w.change(item.key, edit(item), editor);
  await assert.rejects(
    w.change(item.key, edit(item), editor),
    /Revision conflict/
  );
  const path = resolve(root, "incoming/demo/dataset.review.pending.json");
  const data = JSON.parse(await readFile(path));
  data.annotationRevision = "external-change";
  await writeFile(path, JSON.stringify(data));
  assert.equal((await w.item(item.key)).status, "incomplete");
  await assert.rejects(
    w.change(item.key, { ...edit(item), version: 1 }, editor),
    /Manifest changed/
  );
});
test("invalid boxes, duplicate geometry and pixel-derived numeric distance claims rejected", async t => {
  const { w, item } = await setup(t);
  const p = edit(item);
  p.objects[0].box = [0.9, 0, 0.2, 0.5];
  await assert.rejects(w.change(item.key, p, editor), /bounding box/);
  const dup = edit(item);
  dup.objects.push({ ...dup.objects[0], id: "duplicate" });
  await assert.rejects(w.change(item.key, dup, editor), /Duplicate box/);
  const spatial = edit(item);
  spatial.objects[0].spatial.distance = { status: "measured", meters: 1 };
  await assert.rejects(w.change(item.key, spatial, editor), /Measured spatial/);
});
test("derivative is separate, strips metadata and invalidates reviews; original unchanged", async t => {
  const { w, item } = await setup(t);
  const path = await w.mediaPath(item),
    before = await fileHash(path);
  const bytes = await sharp(path).withMetadata().png().toBuffer();
  await w.change(
    item.key,
    {
      action: "derivative",
      version: 0,
      reason: "synthetic metadata removal",
      image: bytes.toString("base64"),
    },
    editor
  );
  const next = await w.item(item.key);
  assert.ok(next.activePath.startsWith(".studio/derived/"));
  assert.equal(await fileHash(path), before);
  const m = await sharp(await w.mediaPath(next)).metadata();
  assert.ok(!m.exif && !m.xmp);
  assert.equal(next.sample.privacy.status, "pending");
});
test("privacy approval requires explicit classifications and checks actual metadata", async t => {
  const { w, item, root } = await setup(t);
  const path = await w.mediaPath(item);
  const bytes = await sharp(path).withMetadata().png().toBuffer();
  await writeFile(path, bytes);
  const manifest = resolve(root, "incoming/demo/dataset.review.pending.json");
  const data = JSON.parse(await readFile(manifest));
  data.samples[0].sha256 = await fileHash(path);
  await writeFile(manifest, JSON.stringify(data));
  await w.change(item.key, edit(item), editor);
  await assert.rejects(
    w.change(
      item.key,
      {
        action: "review",
        kind: "privacy",
        status: "approved",
        version: 1,
        reason: "synthetic privacy review",
      },
      reviewer
    ),
    /Explicit privacy/
  );
  await assert.rejects(
    w.change(
      item.key,
      {
        action: "review",
        kind: "privacy",
        status: "approved",
        version: 1,
        reason: "synthetic privacy review",
        metadataStripped: true,
        faces: "absent",
        plates: "absent",
        personalText: "absent",
      },
      reviewer
    ),
    /Strip metadata/
  );
});

test("reviewed snapshot uses existing validator; pending and synthetic batches cannot export", async t => {
  const { w, item, root } = await setup(t, 1);
  await assert.rejects(w.exportBatch(item.batch, reviewer), /Entire batch/);
  const path = resolve(root, "incoming/demo/dataset.review.pending.json");
  const data = JSON.parse(await readFile(path));
  data.contentKind = "real";
  await writeFile(path, JSON.stringify(data));
  // Fictional rights decisions and generated pixels are test fixtures, never actual training data.
  const current = await w.item(item.key);
  await w.change(item.key, edit(current), editor);
  for (const [n, kind] of ["rights", "privacy", "labels"].entries())
    await w.change(
      item.key,
      {
        action: "review",
        kind,
        status: "approved",
        version: n + 1,
        reason: "fictional fixture independent review",
        exhaustive: true,
        metadataStripped: true,
        faces: "absent",
        plates: "absent",
        personalText: "absent",
      },
      reviewer
    );
  const output = await w.exportBatch(item.batch, reviewer);
  assert.equal(output.trainingStarted, false);
  assert.ok(output.path.startsWith("studio-reviewed-"));
  const snapshot = await w.json(output.path);
  assert.equal(snapshot.samples[0].split, null);
  assert.equal(
    (await validateDataset(snapshot, root, { requireSplit: false })).samples,
    1
  );
  assert.equal((await w.catalog()).items.length, 1);
  const approved = await w.item(item.key);
  await w.change(
    item.key,
    {
      action: "review",
      kind: "rights",
      status: "rejected",
      version: approved.version,
      reason: "fictional changed rights decision",
    },
    reviewer
  );
  assert.equal((await w.item(item.key)).sources[0].trainingAllowed, false);
  await assert.rejects(w.exportBatch(item.batch, reviewer), /Entire batch/);
});
test("edited revision history cannot silently lose its parent chain", async t => {
  const { w, item } = await setup(t);
  await w.change(item.key, edit(item), editor);
  const paths = await w.revisions(item.key);
  const revision = await w.json(paths[0]);
  revision.parentSha256 = "f".repeat(64);
  await writeFile(await w.safe(paths[0]), JSON.stringify(revision));
  const c = await w.catalog();
  assert.ok(c.issues.some(i => i.error.includes("chain integrity")));
  assert.ok(!c.items.some(i => i.key === item.key));
});
test("labels need scene conditions and changed image bytes invalidate all writes", async t => {
  const { w, item } = await setup(t);
  const bad = edit(item);
  bad.conditions = { lighting: "inferred", scene: "outdoor", motion: "static" };
  await assert.rejects(w.change(item.key, bad, editor), /Scene conditions/);
  const path = await w.mediaPath(item);
  const bytes = await readFile(path);
  await writeFile(
    path,
    Buffer.concat([bytes, Buffer.from("external modification")])
  );
  await assert.rejects(w.change(item.key, edit(item), editor), /Media SHA/);
});

async function session(studio) {
  const landing = await fetch(studio.url);
  const cookie = landing.headers.get("set-cookie").split(";")[0];
  const get = async (path, headers = {}) =>
    fetch(studio.url + path, { headers: { cookie, ...headers } });
  const bootstrap = await (await get("/api/bootstrap")).json();
  let csrf = bootstrap.csrf;
  const post = async (path, p, headers = {}) =>
    fetch(studio.url + path, {
      method: "POST",
      headers: {
        cookie,
        "Content-Type": "application/json",
        "X-Studio-CSRF": csrf,
        ...headers,
      },
      body: JSON.stringify(p),
    });
  const login = await post("/api/login", {
    id: "editor",
    password: "synthetic-fixture-password",
  });
  const actor = await login.json();
  assert.equal(login.status, 200);
  csrf = actor.csrf;
  return { get, post, cookie };
}
test("HTTP only binds IPv4 loopback and rejects DNS rebinding, cross-origin and missing CSRF", async t => {
  const { root } = await setup(t);
  const studio = await createStudio(root);
  t.after(() => studio.close());
  assert.equal(studio.server.address().address, "127.0.0.1");
  const badHost = await new Promise((ok, no) => {
    const r = http.get(
      studio.url,
      { headers: { host: "attacker.test" } },
      res => {
        res.resume();
        res.on("end", () => ok(res.statusCode));
      }
    );
    r.on("error", no);
  });
  assert.equal(badHost, 400);
  assert.equal(
    (await fetch(studio.url, { headers: { origin: "https://attacker.test" } }))
      .status,
    400
  );
  const { post } = await session(studio);
  assert.equal(
    (await post("/api/logout", {}, { "X-Studio-CSRF": "wrong" })).status,
    400
  );
  assert.equal(
    (await post("/api/logout", {}, { origin: "http://evil.test" })).status,
    400
  );
});
test("authenticated media serves listed files only, checks SHA and ranges; training endpoint absent", async t => {
  const { root, item } = await setup(t);
  const studio = await createStudio(root);
  t.after(() => studio.close());
  const { get, post } = await session(studio);
  const r = await get("/media/image/" + item.key, { range: "bytes=0-15" });
  assert.equal(r.status, 206);
  assert.equal((await r.arrayBuffer()).byteLength, 16);
  assert.equal((await get("/media/image/" + "0".repeat(32))).status, 400);
  assert.equal((await post("/api/train", {})).status, 404);
  const original = await readFile(await studio.workspace.mediaPath(item));
  await writeFile(
    await studio.workspace.mediaPath(item),
    Buffer.concat([original, Buffer.from("modified")])
  );
  assert.equal((await get("/media/image/" + item.key)).status, 400);
});
test("login failures are throttled and private APIs require authentication", async t => {
  const { root } = await setup(t);
  const studio = await createStudio(root);
  t.after(() => studio.close());
  assert.equal((await fetch(studio.url + "/api/catalog")).status, 400);
  const r = await fetch(studio.url),
    cookie = r.headers.get("set-cookie").split(";")[0];
  const bootstrap = await (
    await fetch(studio.url + "/api/bootstrap", { headers: { cookie } })
  ).json();
  let last;
  for (let n = 0; n < 6; n++)
    last = await fetch(studio.url + "/api/login", {
      method: "POST",
      headers: {
        cookie,
        "Content-Type": "application/json",
        "X-Studio-CSRF": bootstrap.csrf,
      },
      body: JSON.stringify({
        id: "editor",
        password: "incorrect-synthetic-password",
      }),
    });
  assert.match((await last.json()).error, /locked/);
});

test("frozen train/test assignments survive reviewed snapshot export", async t => {
  const { root, w, item } = await setup(t, 3);
  const path = resolve(root, "incoming/demo/dataset.review.pending.json");
  let data = JSON.parse(await readFile(path));
  data.contentKind = "real";
  data = assignSplits(data, 17);
  await writeFile(path, JSON.stringify(data));
  for (const i of (await w.catalog()).items) {
    await w.change(i.key, edit(i), editor);
    for (const [n, kind] of ["rights", "privacy", "labels"].entries())
      await w.change(
        i.key,
        {
          action: "review",
          kind,
          status: "approved",
          version: n + 1,
          reason: "fictional frozen fixture review",
          exhaustive: true,
          metadataStripped: true,
          faces: "absent",
          plates: "absent",
          personalText: "absent",
        },
        reviewer
      );
  }
  const exported = await w.exportBatch(item.batch, reviewer);
  const snapshot = await w.json(exported.path);
  assert.equal(exported.frozenSplitPreserved, true);
  for (const s of snapshot.samples)
    assert.equal(s.split, data.samples.find(i => i.sha256 === s.sha256).split);
  assert.deepEqual(snapshot.splitPolicy, data.splitPolicy);
  assert.throws(() => assignSplits(snapshot, 999), /cannot re-split/);
});
test("rights evidence through internal junctions and unverified metric records are not accepted", async t => {
  const { root, w, item } = await setup(t, 1);
  await symlink(
    resolve(root, "incoming/demo/rights"),
    resolve(root, "incoming/demo/alias"),
    process.platform === "win32" ? "junction" : "dir"
  );
  const path = resolve(root, "incoming/demo/dataset.review.pending.json");
  const data = JSON.parse(await readFile(path));
  data.sources[0].rightsReview.evidence.path = "alias/team.txt";
  data.samples[0].annotation.objects[0].spatial.distance = {
    status: "measured",
    meters: 1,
    uncertaintyMeters: 0,
  };
  await writeFile(path, JSON.stringify(data));
  const current = await w.item(item.key);
  assert.equal(current.measurements["object-0"].validContract, false);
  await assert.rejects(w.sourceEvidence(current), /Links|Reparse/);
});
