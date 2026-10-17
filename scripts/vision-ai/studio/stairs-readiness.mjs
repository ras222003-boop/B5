/** Reuse split/export/preflight gates; never train, approve rights, register test or infer on it. */
import { spawn } from "node:child_process";
import { isAbsolute, resolve, basename } from "node:path";
import { realpath } from "node:fs/promises";
import { assignSplits } from "../data.mjs";
import { stairsLabels, stairsTruth } from "../stairs-task.mjs";
import { requireValue as check, repo } from "../common.mjs";

export function coverage(samples, policy) {
  const rows = {};
  for (const split of ["train", "validation", "test"]) {
    const selected = samples.filter(s => s.split === split),
      positive = Object.fromEntries(stairsLabels.map(k => [k, 0]));
    let negatives = 0;
    for (const s of selected) {
      const labels = new Set(
        stairsTruth(s).map(o => stairsLabels[o.classId - 2301])
      );
      if (!labels.size) {
        check(
          s.hardNegatives?.length,
          "Reviewed stairs hard-negative evidence required"
        );
        negatives++;
      }
      for (const k of labels) positive[k]++;
    }
    const groups = new Set(selected.map(s => s.leakageGroup)).size,
      m = policy.minimumEngineeringCohort;
    rows[split] = {
      images: selected.length,
      positive,
      negatives,
      groups,
      passed:
        stairsLabels.every(
          k => positive[k] >= m.positiveImagesPerClass[split]
        ) &&
        negatives >= m.negativeImages[split] &&
        groups >= m.independentGroups[split],
    };
  }
  return { rows, passed: Object.values(rows).every(r => r.passed) };
}
export function stairsSplits(data, cohort, policy) {
  const held = s => cohort.samples.some(x => x.imageSha256 === s.sha256),
    test = data.samples.filter(held).map(s => ({ ...s, split: "test" })),
    dev = data.samples.filter(s => !held(s));
  check(
    !dev.some(s => cohort.samples.some(x => x.group === s.leakageGroup)),
    "Independent test groups overlap development"
  );
  const testCoverage = coverage(test, policy).rows.test;
  check(
    testCoverage.passed,
    "Independent test class/negative/session coverage incomplete"
  );
  const count = new Set(dev.map(s => s.leakageGroup)).size;
  check(count >= 3, "Three development groups required");
  const target = Math.min(count - 2, Math.max(1, Math.round(count * 0.36))),
    targets = [
      ...new Set([target, target + 1, target - 1, target + 2, target - 2]),
    ].filter(x => x > 0 && x < count - 1);
  let attempts = 0;
  // Uses only reviewed development labels to satisfy coverage. No inference metrics/test tuning.
  for (const groups of targets)
    for (let n = 0; n < 64; n++) {
      const grouped = assignSplits({ ...data, samples: dev }, 20261014 + n, {
        validationRatio: groups / count,
        testRatio: 0,
      });
      attempts++;
      const samples = [...grouped.samples, ...test],
        checked = coverage(samples, policy);
      if (checked.passed)
        return {
          ...data,
          samples,
          splitPolicy: {
            ...grouped.splitPolicy,
            task: "basira-stairs-v1",
            coverageOnlySelection: {
              attempts,
              testCohortUnchanged: true,
              inferenceMetricsUsed: false,
            },
          },
          coverage: checked,
        };
    }
  throw new Error(
    "Reviewed development class/negative/session coverage cannot satisfy a grouped split; keep data unfrozen"
  );
}
export async function runDataPreflight(w, result) {
  let config;
  try {
    config = await w.json(".studio/training-readiness.json");
  } catch (e) {
    if (e.code === "ENOENT")
      return {
        status: "WAITING_LOCAL_PREFLIGHT_CONFIGURATION",
        trainingStarted: false,
      };
    throw e;
  }
  check(
    config.schemaVersion === 1 &&
      isAbsolute(config.python) &&
      /^(python(?:3(?:\.\d+)?)?)(?:\.exe)?$/i.test(basename(config.python)),
    "Administrator configured Python interpreter required"
  );
  check(
    (await realpath(config.python)).toLowerCase() ===
      resolve(config.python).toLowerCase(),
    "Interpreter alias/links forbidden"
  );
  const descriptor = await w.safe(config.pretrained),
    p = await w.json(config.pretrained);
  if (
    p.reviewStatus !== "approved" ||
    p.trainingAllowed !== true ||
    !p.reviewer
  )
    return {
      status: "WAITING_PRETRAINED_RIGHTS_REVIEW",
      trainingStarted: false,
    };
  const args = [
    resolve(repo, "scripts/vision-ai/train.py"),
    "data-preflight",
    "--manifest",
    await w.safe(result.manifest),
    "--data-root",
    w.root,
    "--export",
    await w.safe(result.export),
    "--pretrained",
    descriptor,
    "--config",
    resolve(repo, "ml/vision/experiment.stairs.json"),
  ];
  return new Promise((ok, no) => {
    const child = spawn(config.python, args, {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "",
      size = 0;
    const timer = setTimeout(() => {
      child.kill();
      no(new Error("Data preflight timed out; training not started"));
    }, 120_000);
    child.on("error", () => {
      clearTimeout(timer);
      no(new Error("Local preflight interpreter unavailable"));
    });
    child.stdout.on("data", d => {
      size += d.length;
      if (size > 500_000) {
        child.kill();
      } else out += d;
    });
    child.stderr.resume();
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0)
        return ok({
          status: "DATA_PREFLIGHT_BLOCKED",
          exitCode: code,
          trainingStarted: false,
        });
      try {
        const r = JSON.parse(out);
        check(
          r.status === "DATA_PREFLIGHT_ONLY" && r.trainingPerformed === false,
          "Unexpected preflight result"
        );
        ok({
          ...r,
          status: "READY_REQUEST_EXPLICIT_TRAINING_PERMISSION",
          trainingStarted: false,
        });
      } catch {
        no(new Error("Invalid data preflight report"));
      }
    });
  });
}
export async function prepareApprovedStairs(b, actor) {
  b.role("approve", actor);
  const c = await b.w.catalog(),
    keys = [];
  for (const i of c.items) {
    if (
      i.contentKind !== "real" ||
      i.status !== "approved" ||
      i.sample.media.kind !== "image"
    )
      continue;
    const stairs = i.sample.annotation.objects.filter(o => o.classId === 23),
      prep = await b.preparation(i);
    if (
      (stairs.length && stairs.every(o => o.stairsDirection)) ||
      (!stairs.length &&
        i.sample.hardNegatives.length &&
        (prep?.task === "basira-stairs-v1" ||
          i.sample.taskCandidate?.task === "basira-stairs-v1"))
    )
      keys.push(i.key);
  }
  let r;
  try {
    if (!keys.length)
      r = { status: "WAITING_APPROVED_STAIRS_DATA", trainingStarted: false };
    else if (
      !(await (await import("../test-cohort.mjs")).finalCohort(b.w.root))
    )
      r = {
        status: "WAITING_INDEPENDENT_TEST_REGISTRATION",
        approvedCandidates: keys.length,
        trainingStarted: false,
      };
    else {
      const frozen = await b.prepareTraining(keys, actor, {
        task: "basira-stairs-v1",
      });
      r = {
        ...frozen,
        preflight: await runDataPreflight(b.w, frozen),
        trainingStarted: false,
      };
    }
  } catch (e) {
    r = {
      status: "DATA_GATES_BLOCKED",
      reason: e.message,
      trainingStarted: false,
    };
  }
  await b.jobWrite(".studio/batch-review/stairs-readiness.json", {
    ...r,
    checkedAt: new Date().toISOString(),
    humanApprovalsCreated: 0,
  });
  return r;
}
