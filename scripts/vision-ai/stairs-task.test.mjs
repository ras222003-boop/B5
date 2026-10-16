import test from "node:test";
import assert from "node:assert/strict";
import {
  stairsTruth,
  validateStairsDirection,
  imagePosition,
  stairsMetrics,
} from "./stairs-task.mjs";
import { readJson } from "./common.mjs";

test("generic approval does not infer a direction or change historical class 23", () => {
  const o = { id: "original", classId: 23, box: [0.1, 0.1, 0.8, 0.8] };
  validateStairsDirection(o);
  assert.throws(
    () => stairsTruth({ annotation: { objects: [o] } }),
    /Generic stairs/
  );
  for (const d of [
    { label: "stairs_up", evidence: "" },
    { label: "guess", evidence: "guess" },
  ])
    assert.throws(
      () => validateStairsDirection({ ...o, stairsDirection: d }),
      /evidence/
    );
  assert.throws(() =>
    validateStairsDirection({
      ...o,
      classId: 2,
      stairsDirection: { label: "stairs_up", evidence: "visible risers" },
    })
  );
  const sample = {
    annotation: {
      objects: [
        {
          ...o,
          stairsDirection: {
            label: "stairs_present_uncertain_direction",
            evidence: "landing hides flight orientation",
          },
        },
        { id: "person", classId: 1 },
      ],
    },
  };
  assert.equal(stairsTruth(sample)[0].classId, 2303);
  assert.equal(sample.annotation.objects[0].classId, 23);
  assert.equal(sample.annotation.objects.length, 2);
});
test("image thirds and central overlap are independent and never metric or a walking path", async () => {
  const policy = await readJson(
    new URL("../../ml/vision/stairs-task.v1.json", import.meta.url)
  );
  assert.deepEqual(policy.position.thirds, [1 / 3, 2 / 3]);
  assert.equal(imagePosition([0, 0, 1 / 3, 0.5]).horizontal, "left");
  assert.equal(
    imagePosition([0, 0, 1 / 3, 0.5]).overlapsCentralImageRegion,
    false
  );
  assert.equal(imagePosition([0.1, 0, 0.48, 0.5]).horizontal, "center");
  const large = imagePosition([0.335, 0.42, 0.665, 0.58]);
  assert.equal(large.horizontal, "right");
  assert.equal(large.overlapsCentralImageRegion, true);
  assert.equal(large.metricDistance, null);
  assert.equal(large.walkingPathKnown, false);
  assert.throws(() => imagePosition([NaN, 0, 1, 1]));
  assert.throws(() => imagePosition([0.9, 0, 0.5, 1]));
});
test("presence success does not conceal incorrect direction, localization or negative false positives", () => {
  const box = { x: 0.1, y: 0.1, width: 0.2, height: 0.5 };
  const result = stairsMetrics([
    {
      id: "positive",
      groundTruth: [{ class: "stairs_up", box }],
      predictions: [{ class: "stairs_down", box, score: 0.9 }],
    },
    {
      id: "negative",
      groundTruth: [],
      predictions: [
        { class: "stairs_present_uncertain_direction", box, score: 0.7 },
      ],
    },
  ]);
  assert.deepEqual(result.framePresence, { tp: 1, fp: 1, fn: 0, tn: 0 });
  assert.equal(result.directionConfusionAtIoU50.stairs_up.stairs_down, 1);
  assert.equal(result.position.matchedBoxes, 1);
  assert.equal(result.position.horizontalCorrect, 1);
  assert.equal(result.position.metricDistance, null);
});
