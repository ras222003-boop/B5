import test from "node:test";
import assert from "node:assert/strict";
import { reconcileLabels } from "./ui/label-draft.mjs";
const object = { id: "one", classId: 1, box: [0.1, 0.1, 0.2, 0.2] },
  base = {
    baseHash: "same",
    sample: {
      sha256: "sha",
      width: 640,
      height: 480,
      conditions: { scene: "indoor", lighting: "indoor", motion: "static" },
      annotation: { objects: [object] },
    },
  };
test("reconciliation preserves disjoint edits and server additions without mutating inputs", () => {
  const mine = {
    objects: [{ ...object, box: [0.2, 0.1, 0.2, 0.2] }],
    conditions: base.sample.conditions,
  };
  const latest = structuredClone(base);
  latest.sample.annotation.objects[0].classId = 2;
  latest.sample.annotation.objects.push({
    id: "two",
    classId: 3,
    box: [0.5, 0.5, 0.2, 0.2],
  });
  const out = reconcileLabels(base, mine, latest);
  assert.deepEqual(out.conflicts, []);
  assert.equal(out.objects[0].classId, 2);
  assert.equal(out.objects[0].box[0], 0.2);
  assert.equal(out.objects.length, 2);
  assert.equal(base.sample.annotation.objects[0].box[0], 0.1);
});
test("overlapping edits and deletion vs edit require an explicit decision", () => {
  const mine = {
    objects: [{ ...object, box: [0.2, 0.1, 0.2, 0.2] }],
    conditions: base.sample.conditions,
  };
  const latest = structuredClone(base);
  latest.sample.annotation.objects[0].box = [0.3, 0.1, 0.2, 0.2];
  assert.ok(reconcileLabels(base, mine, latest).conflicts.length);
  mine.objects = [];
  assert.ok(reconcileLabels(base, mine, latest).conflicts.length);
});
test("image/fingerprint changes cannot be reconciled and conditions merge per field", () => {
  const latest = structuredClone(base);
  latest.sample.sha256 = "other";
  assert.ok(
    reconcileLabels(
      base,
      { objects: [object], conditions: base.sample.conditions },
      latest
    ).conflicts.length
  );
  latest.sample.sha256 = "sha";
  latest.sample.conditions.lighting = "mixed";
  const out = reconcileLabels(
    base,
    {
      objects: [object],
      conditions: { ...base.sample.conditions, scene: "outdoor" },
    },
    latest
  );
  assert.deepEqual(out.conflicts, []);
  assert.equal(out.conditions.lighting, "mixed");
  assert.equal(out.conditions.scene, "outdoor");
});
