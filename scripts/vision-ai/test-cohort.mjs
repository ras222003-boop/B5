/** Private, append-only exposure and final-test boundaries, shared with existing validators. */
import {
  readFile,
  readdir,
  writeFile,
  lstat,
  realpath,
  open,
  unlink,
} from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { requireValue as check } from "./common.mjs";
const dir = ".studio/batch-review";
export async function finalCohort(root) {
  try {
    let p = resolve(root);
    for (const part of [...dir.split("/"), "final-test.json"]) {
      p = resolve(p, part);
      check(
        !(await lstat(p)).isSymbolicLink() && (await realpath(p)) === p,
        "Final-test policy links forbidden"
      );
    }
    return JSON.parse(await readFile(p, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
export async function assertNotFinalTest(root, item) {
  const cohort = await finalCohort(root);
  check(
    !cohort?.samples.some(
      s =>
        s.key === item.key ||
        s.originalSha256 === item.sample.sha256 ||
        s.imageSha256 === (item.activeSha256 ?? item.sample.sha256) ||
        s.group === item.sample.leakageGroup ||
        (s.videoSha256 && s.videoSha256 === item.sample.media?.video?.sha256)
    ),
    "Frozen independent final-test sample/session: development analysis and edits are forbidden"
  );
}
export async function markDevelopment(w, item) {
  check(
    item.sample.intendedUse !== "independent_test_candidate",
    "Reserved independent-test candidate: development inference is forbidden before registration too"
  );
  const lockPath = await w.safe(".studio/write.lock", true),
    lock = await open(lockPath, "wx", 0o600);
  try {
    await assertNotFinalTest(w.root, item);
    await w.ensure(".studio/batch-review");
    await w.ensure(`${dir}/exposures`);
    await writeFile(
      await w.safe(`${dir}/exposures/${randomUUID()}.json`, true),
      JSON.stringify({
        key: item.key,
        sha256: item.sample.sha256,
        group: item.sample.leakageGroup,
        videoSha256: item.sample.media?.video?.sha256 ?? null,
        at: new Date().toISOString(),
      }),
      { flag: "wx", mode: 0o600 }
    );
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
export async function exposures(w) {
  const result = [];
  try {
    result.push(...(await w.json(`${dir}/development-observed.json`)).samples);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  try {
    for (const f of await readdir(await w.safe(`${dir}/exposures`)))
      if (/^[a-f0-9-]{36}\.json$/.test(f))
        result.push(await w.json(`${dir}/exposures/${f}`));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  return result;
}
export async function guardFinalSplits(data, root) {
  for (const s of data.samples ?? [])
    if (s.intendedUse === "independent_test_candidate")
      check(
        s.split === null || s.split === "test",
        "Reserved independent-test candidate cannot enter training or validation"
      );
  const c = await finalCohort(root);
  if (!c) return;
  for (const s of data.samples ?? [])
    if (
      c.samples.some(
        x =>
          x.originalSha256 === s.sha256 ||
          x.imageSha256 === s.sha256 ||
          x.group === s.leakageGroup ||
          (x.videoSha256 && x.videoSha256 === s.media?.video?.sha256)
      )
    )
      check(
        s.split === null || s.split === "test",
        "Protected final-test content cannot enter training or validation"
      );
}
