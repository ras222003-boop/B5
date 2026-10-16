import test from "node:test";
import assert from "node:assert/strict";
import { selectItems } from "./prereview-run.mjs";
test("selective existing prereview cannot rerun approved samples, wrong kind or unknown IDs", () => {
  const items = [
    { key: "a".repeat(32), contentKind: "real", status: "pending" },
    { key: "b".repeat(32), contentKind: "real", status: "approved" },
    { key: "c".repeat(32), contentKind: "synthetic", status: "pending" },
  ];
  assert.deepEqual(
    selectItems(items).map(i => i.key),
    ["a".repeat(32)]
  );
  assert.deepEqual(selectItems(items, { keys: ["a".repeat(32)] }), [items[0]]);
  for (const keys of [
    [],
    ["b".repeat(32)],
    ["c".repeat(32)],
    ["d".repeat(32)],
    ["../escape"],
    ["a".repeat(32), "a".repeat(32)],
  ])
    assert.throws(() => selectItems(items, { keys }));
});
