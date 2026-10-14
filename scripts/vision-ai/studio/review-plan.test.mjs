import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { fixture } from "./fixture.mjs";
import { StudioWorkspace } from "./workspace.mjs";
import { reviewPlan } from "./review-plan.mjs";
import { createStudio } from "./server.mjs";
async function setup(t) {
  const temp = await mkdtemp(resolve(tmpdir(), "basira-review-plan-"));
  const root = resolve(temp, "data");
  await fixture(root, { images: 2 });
  t.after(() => rm(temp, { recursive: true, force: true }));
  const w = await new StudioWorkspace(root).init();
  const items = (await w.catalog()).items;
  return {
    w,
    items,
    save: p =>
      writeFile(
        resolve(root, ".studio/human-review-plan.json"),
        JSON.stringify(p)
      ),
  };
}
const row = (i, priority) => ({
  key: i.key,
  version: i.version,
  imageSha256: i.sample.sha256,
  priority,
  tasks: [
    {
      kind: "source_unmatched",
      label: "Review a source box; not a confirmed error",
      box: [0.1, 0.1, 0.3, 0.3],
      classId: 1,
      score: 0.8,
    },
  ],
  approval: true,
});
test("optional queue does not fabricate review tasks or approval", async t => {
  const { w } = await setup(t);
  assert.deepEqual(await reviewPlan(w), {
    schemaVersion: 1,
    items: [],
    stale: 0,
    humanApproval: false,
  });
});
test("queue orders current versions and strips attempted approval/extra fields without modifying data", async t => {
  const { w, items, save } = await setup(t);
  await save({ schemaVersion: 1, items: [row(items[0], 2), row(items[1], 1)] });
  const p = await reviewPlan(w);
  assert.equal(p.items[0].key, items[1].key);
  assert.ok(p.items.every(i => i.approval === false));
  assert.equal(p.items[0].tasks[0].status, "candidate_only_human_required");
  assert.equal((await w.item(items[0].key)).version, 0);
});
test("stale version or changed image hash is hidden rather than applied to a different image", async t => {
  const { w, items, save } = await setup(t);
  await save({
    schemaVersion: 1,
    items: [
      { ...row(items[0], 1), version: 99 },
      { ...row(items[1], 2), imageSha256: "0".repeat(64) },
    ],
  });
  const p = await reviewPlan(w);
  assert.equal(p.stale, 2);
  assert.equal(p.items.length, 0);
});
test("malformed priorities, duplicate keys, classes and boxes fail closed", async t => {
  const { w, items, save } = await setup(t);
  for (const p of [
    { schemaVersion: 1, items: [row(items[0], 0)] },
    { schemaVersion: 1, items: [row(items[0], 1), row(items[0], 2)] },
    {
      schemaVersion: 1,
      items: [
        {
          ...row(items[0], 1),
          tasks: [{ kind: "bad", label: "bad", box: [0, 0, 2, 2] }],
        },
      ],
    },
    {
      schemaVersion: 1,
      items: [
        {
          ...row(items[0], 1),
          tasks: [{ kind: "bad", label: "bad", classId: 999 }],
        },
      ],
    },
  ]) {
    await save(p);
    await assert.rejects(reviewPlan(w));
  }
});

test("private review endpoint needs login and cannot write or approve a plan", async t => {
  const { w, items, save } = await setup(t);
  await save({ schemaVersion: 1, items: [row(items[0], 1)] });
  const studio = await createStudio(w.root);
  t.after(() => studio.close());
  assert.equal((await fetch(studio.url + "/api/review-plan")).status, 400);
  const landing = await fetch(studio.url),
    cookie = landing.headers.get("set-cookie").split(";")[0];
  const bootstrap = await (
    await fetch(studio.url + "/api/bootstrap", { headers: { cookie } })
  ).json();
  const login = await fetch(studio.url + "/api/login", {
    method: "POST",
    headers: {
      cookie,
      "Content-Type": "application/json",
      "X-Studio-CSRF": bootstrap.csrf,
    },
    body: JSON.stringify({
      id: "reviewer",
      password: "synthetic-fixture-password",
    }),
  });
  const account = await login.json();
  assert.equal(login.status, 200);
  const r = await fetch(studio.url + "/api/review-plan", {
    headers: { cookie },
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).humanApproval, false);
  assert.equal(
    (
      await fetch(studio.url + "/api/review-plan", {
        method: "POST",
        headers: {
          cookie,
          "Content-Type": "application/json",
          "X-Studio-CSRF": account.csrf,
        },
        body: JSON.stringify({ approval: true }),
      })
    ).status,
    404
  );
  assert.equal((await w.catalog()).summary.approved, 0);
});
