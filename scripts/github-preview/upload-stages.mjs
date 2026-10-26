/** Resume small fast-forward Git transfers after an oversized pack times out. Never rewrites a remote ref. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const run = promisify(execFile),
  [checkoutArg, snapshot, journalArg, baseCommit] = process.argv.slice(2),
  cwd = resolve(checkoutArg),
  journalPath = resolve(journalArg);
if (!/^[a-f0-9]{40}$/.test(snapshot ?? ""))
  throw Error("Verified deployment snapshot required");
const git = async (args, extra = {}) =>
  (
    await run("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 4_000_000,
      windowsHide: true,
      ...extra,
    })
  ).stdout.trim();
if (
  (await git(["remote", "get-url", "origin"])) !==
  "https://github.com/ras222003-boop/basira-iphone-research-preview.git"
)
  throw Error("Only the independent preview repository may be uploaded");
await run(process.execPath, ["verify-preview.mjs"], {
  cwd,
  encoding: "utf8",
  windowsHide: true,
});
const tree = await git(["rev-parse", snapshot + "^{tree}"]),
  ref = "refs/heads/codex/preview";
let journal;
try {
  journal = JSON.parse(await readFile(journalPath, "utf8"));
  if (journal.snapshot !== snapshot || journal.tree !== tree)
    throw Error("Another delivery owns this journal");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
if (!journal) {
  const remote =
    (await git(["ls-remote", "origin", ref])).split(/\s/)[0] || null;
  if (baseCommit) {
    if (!/^[a-f0-9]{40}$/.test(baseCommit) || remote !== baseCommit)
      throw Error("Explicit existing delivery base must match remote");
    if (
      await git([
        "diff",
        "--name-only",
        "--diff-filter=D",
        baseCommit,
        snapshot,
      ])
    )
      throw Error("Recovery cannot delete existing files");
  } else if (remote)
    throw Error("Do not replace an existing preview branch; inspect it first");
  const changed = baseCommit
    ? new Set(
        (await git(["diff", "--name-only", baseCommit, snapshot])).split("\n")
      )
    : null;
  const rows = (await git(["ls-tree", "-r", "--long", snapshot]))
    .split("\n")
    .map(line => {
      const m = /^(\d+) blob ([a-f0-9]{40})\s+(\d+)\t(.+)$/.exec(line);
      if (!m || m[1] !== "100644" || m[4].includes(".."))
        throw Error("Unqualified deployment tree");
      return { mode: m[1], sha: m[2], bytes: Number(m[3]), path: m[4] };
    })
    .filter(r => !changed || changed.has(r.path))
    .sort((a, b) => a.bytes - b.bytes);
  const batches = [];
  let batch = [],
    size = 0;
  for (const row of rows) {
    if (batch.length && size + row.bytes > 7_000_000) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(row);
    size += row.bytes;
  }
  if (batch.length) batches.push(batch);
  const env = {
    ...process.env,
    GIT_INDEX_FILE: resolve(cwd, ".git/preview-delivery.index"),
  };
  await git(baseCommit ? ["read-tree", baseCommit] : ["read-tree", "--empty"], {
    env,
  });
  const parts = [];
  let parent = baseCommit;
  for (let i = 0; i < batches.length; i++) {
    for (const r of batches[i])
      await git(
        [
          "update-index",
          "--add",
          "--cacheinfo",
          r.mode + "," + r.sha + "," + r.path,
        ],
        { env }
      );
    const currentTree = await git(["write-tree"], { env }),
      args = [
        "-c",
        "commit.gpgsign=false",
        "commit-tree",
        currentTree,
        ...(parent ? ["-p", parent] : []),
        "-m",
        `Research preview verified delivery ${i + 1}/${batches.length}`,
      ];
    const sha = await git(args);
    parts.push({
      sha,
      parent: parent ?? null,
      files: batches[i].length,
      bytes: batches[i].reduce((n, r) => n + r.bytes, 0),
      uploaded: false,
    });
    parent = sha;
  }
  if ((await git(["rev-parse", parent + "^{tree}"])) !== tree)
    throw Error("Incremental delivery differs from verified snapshot");
  journal = { schemaVersion: 1, snapshot, tree, ref, parts, complete: false };
  await writeFile(journalPath, JSON.stringify(journal, null, 2), {
    flag: "wx",
  });
}
for (let i = 0; i < journal.parts.length; i++) {
  const part = journal.parts[i],
    remote = (await git(["ls-remote", "origin", ref])).split(/\s/)[0] || null;
  if (remote === part.sha) {
    part.uploaded = true;
    continue;
  }
  if (part.uploaded) continue;
  if (remote !== part.parent)
    throw Error("Remote changed outside this delivery; refusing a force push");
  try {
    await git(
      [
        "-c",
        "http.version=HTTP/1.1",
        "-c",
        "http.postBuffer=33554432",
        "push",
        "--porcelain",
        "origin",
        part.sha + ":" + ref,
      ],
      { timeout: 120000 }
    );
  } catch (e) {
    const observed =
      (await git(["ls-remote", "origin", ref])).split(/\s/)[0] || null;
    if (observed !== part.sha) {
      journal.lastFailure = {
        part: i + 1,
        code: e.code ?? "push_failed",
        atUtc: new Date().toISOString(),
      };
      await writeFile(journalPath, JSON.stringify(journal, null, 2));
      throw Error(
        "Bounded Git transfer failed at part " +
          (i + 1) +
          "; previous parts and journal are preserved"
      );
    }
  }
  part.uploaded = true;
  await writeFile(journalPath, JSON.stringify(journal, null, 2));
  console.log(
    JSON.stringify({
      uploadedPart: i + 1,
      parts: journal.parts.length,
      files: part.files,
      bytes: part.bytes,
    })
  );
}
const remote = (await git(["ls-remote", "origin", ref])).split(/\s/)[0];
if (remote !== journal.parts.at(-1).sha)
  throw Error("Final remote identity mismatch");
journal.complete = true;
journal.deploymentCommit = remote;
await writeFile(journalPath, JSON.stringify(journal, null, 2));
console.log(
  JSON.stringify({
    complete: true,
    deploymentCommit: remote,
    tree,
    sourceSnapshot: snapshot,
  })
);
