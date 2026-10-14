import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { repo, writeJson, fileHash } from "./common.mjs";

const [base = "f4ca091", output] = process.argv.slice(2);
const git = args =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
const changed = git([
  "diff",
  "--name-only",
  "-z",
  base,
  "--diff-filter=ACMRT",
  "--",
]);
const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"]);
const findings = [],
  files = [...new Set([...changed, ...untracked])];
let studioEvidence;
let assistantEvidence;
try {
  studioEvidence = JSON.parse(
    await readFile(
      resolve(repo, "docs/vision-ai-evidence/studio/browser-validation.json"),
      "utf8"
    )
  );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
try {
  assistantEvidence = JSON.parse(
    await readFile(
      resolve(
        repo,
        "docs/vision-ai-evidence/studio-assistant/browser-validation.json"
      ),
      "utf8"
    )
  );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const patterns = {
  private_key: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  github_token: /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})/,
  api_key: /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/,
  aws_key: /(?<![A-Za-z0-9+/])AKIA[0-9A-Z]{16}(?![A-Za-z0-9+/])/,
  signed_url:
    /[?&](?:X-Amz-Signature|X-Goog-Signature|sig)=[A-Za-z0-9%+/]{20,}/,
};
for (const file of files) {
  // Only the six exact synthetic-only UI screenshot paths below may leave Git.
  // All other dataset/media binaries remain prohibited. The report binds exact bytes.
  if (
    /^docs\/vision-ai-evidence\/studio\/(?:desktop|editor|experiments|mobile)-synthetic\.png$/.test(
      file
    ) ||
    /^docs\/vision-ai-evidence\/studio-assistant\/(?:assistant|comparison)-synthetic\.png$/.test(
      file
    )
  ) {
    const report = file.includes("/studio-assistant/")
      ? assistantEvidence
      : studioEvidence;
    const evidence = report?.screenshots?.find(s => s.path === file);
    const raw = await readFile(resolve(repo, file));
    if (
      report?.contentKind !== "synthetic-ui-only" ||
      report?.trainingPerformed !== false ||
      report?.externalRequests?.length !== 0 ||
      evidence?.contentKind !== "synthetic-ui-only" ||
      evidence.sha256 !== (await fileHash(resolve(repo, file))) ||
      raw.length > 2_000_000 ||
      raw.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    )
      findings.push({ file, kind: "unverified-synthetic-ui-screenshot" });
    continue;
  }
  if (
    /(^|\/)(?:\.env(?!\.example)|Basira-Vision-Datasets|\.vision-ai)(?:\/|$)/.test(
      file
    ) ||
    /\.(?:png|jpe?g|webp|mp4|mov|webm|mkv|pt|pth|onnx|tflite|zip|pem|key)$/i.test(
      file
    )
  )
    findings.push({ file, kind: "private-data-or-binary-path" });
  const absolute = resolve(repo, file);
  if ((await stat(absolute)).size > 5_000_000) {
    findings.push({ file, kind: "large-file-requires-review" });
    continue;
  }
  const text = await readFile(absolute, "utf8");
  for (const [kind, pattern] of Object.entries(patterns))
    if (pattern.test(text)) findings.push({ file, kind });
  if (extname(file) === ".json") {
    const value = JSON.parse(text);
    if (
      (value.sources && value.samples) ||
      (value.status === "approved" && value.binding)
    )
      findings.push({
        file,
        kind: "dataset-or-training-approval-must-stay-private",
      });
  }
}
const report = {
  scope: "outgoing-files-pattern-and-media-audit",
  base,
  filesChecked: files.length,
  findings,
  passed: findings.length === 0,
  limitation:
    "Pattern checks cannot prove absence of all secrets or personal information; human review remains necessary.",
};
if (output) await writeJson(output, report);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
