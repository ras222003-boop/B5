/** Prepare a fast-forward update in the independent repository. Reuses verified model parts; never force pushes. */
import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { resolve, dirname, isAbsolute, relative } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile),
  [buildArg, checkoutArg, parent] = process.argv.slice(2),
  build = resolve(buildArg),
  cwd = resolve(checkoutArg),
  git = async (args, extra = {}) =>
    (
      await run("git", args, {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        ...extra,
      })
    ).stdout.trim();
if (
  !/^[a-f0-9]{40}$/.test(parent ?? "") ||
  (await git(["remote", "get-url", "origin"])) !==
    "https://github.com/ras222003-boop/basira-iphone-research-preview.git"
)
  throw Error(
    "Only the independent repository and an exact parent are accepted"
  );
if (
  (await git(["ls-remote", "origin", "refs/heads/codex/preview"])).split(
    /\s/
  )[0] !== parent
)
  throw Error("Preview advanced; inspect before updating");
const receipt = JSON.parse(
    await readFile(resolve(build, "static-build-receipt.json"), "utf8")
  ),
  hash = b => createHash("sha256").update(b).digest("hex");
if (
  !receipt.publishable ||
  !receipt.sourceWasClean ||
  receipt.developmentBuild ||
  receipt.privateMediaIncluded !== false ||
  receipt.restrictedModelsIncluded !== false
)
  throw Error("Clean qualified build required");
const transport = JSON.parse(await git(["show", parent + ":MODEL-PARTS.json"]));
if (
  transport.sha256 !==
  "1f0e088797c8792329c0270151fc375193158f5406a94c9c214cfb3d72e54a38"
)
  throw Error("Review changed model transport");
const env = {
  ...process.env,
  GIT_INDEX_FILE: resolve(
    cwd,
    ".git/refresh-" + receipt.sourceCommit + ".index"
  ),
};
await git(["read-tree", parent], { env });
const add = async path => {
  const sha = await git(["hash-object", "-w", path]);
  await git(
    ["update-index", "--add", "--cacheinfo", "100644," + sha + "," + path],
    { env }
  );
};
for (const row of receipt.files) {
  const file = resolve(build, "site", row.path),
    rel = relative(resolve(build, "site"), file);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw Error("Invalid runtime path");
  const bytes = await readFile(file);
  if (bytes.length !== row.bytes || hash(bytes) !== row.sha256)
    throw Error("Changed build asset");
  if (row.path === transport.target) {
    if (row.sha256 !== transport.sha256 || row.bytes !== transport.bytes)
      throw Error("Transport no longer matches model");
    continue;
  }
  await mkdir(dirname(resolve(cwd, row.path)), { recursive: true });
  await copyFile(file, resolve(cwd, row.path));
  await add(row.path);
}
await writeFile(resolve(cwd, "SOURCE.json"), JSON.stringify(receipt, null, 2));
await add("SOURCE.json");
const readmePath = resolve(cwd, "README.md"),
  readme = await readFile(readmePath, "utf8"),
  sourceLine =
    /^Source: https:\/\/github\.com\/ras222003-boop\/B5\/tree\/[a-f0-9]{40}$/m;
if (!sourceLine.test(readme))
  throw Error("Review changed preview README source identity");
const priorSafetyText =
  "An iPhone/VoiceOver test must be performed by the device owner and is NOT claimed by the desktop software-media test.",
  currentSafetyText =
    "The browser preview has no native iPhone LiDAR bridge or native haptics. Safari does not support the Web Vibration API, so vibration behaviour must be tested in the signed iOS app on a real device. " +
    priorSafetyText;
if (!readme.includes(priorSafetyText))
  throw Error("Review changed preview README safety text");
await writeFile(
  readmePath,
  readme.replace(
    sourceLine,
    "Source: https://github.com/ras222003-boop/B5/tree/" + receipt.sourceCommit
  ).replace(
    readme.includes(currentSafetyText) ? currentSafetyText : priorSafetyText,
    currentSafetyText
  )
);
await add("README.md");
const tree = await git(["write-tree"], { env }),
  commit = await git([
    "-c",
    "commit.gpgsign=false",
    "commit-tree",
    tree,
    "-p",
    parent,
    "-m",
    "Refresh isolated vision runtime from B5 " +
      receipt.sourceCommit.slice(0, 7),
  ]);
await git([
  "branch",
  "codex/refresh-" + receipt.sourceCommit.slice(0, 7),
  commit,
]);
console.log(
  JSON.stringify({
    commit,
    parent,
    tree,
    sourceCommit: receipt.sourceCommit,
    verifiedFiles: receipt.files.length,
    rawModelReuploaded: false,
    uploaded: false,
  })
);
