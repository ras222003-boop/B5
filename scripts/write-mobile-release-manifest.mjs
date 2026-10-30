import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const shaPattern = /^[0-9a-f]{40}$/;
const excludedFile = "basira-mobile-release.json";

function tryGitRevision(cwd) {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim().toLowerCase();
    return shaPattern.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

async function hashFile(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

async function listFiles(root, current = "") {
  const base = path.join(root, current);
  const entries = await readdir(base, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const rel = path.posix.join(current, entry.name);
    if (entry.isSymbolicLink()) throw Error("Symlink not allowed in distributable web assets");
    if (entry.isDirectory()) result.push(...await listFiles(root, rel));
    else if (entry.isFile() && rel !== excludedFile) result.push(rel);
    else if (!entry.isFile()) throw Error("Non-file asset in web distribution");
  }
  return result;
}

function routeNames(appSource) {
  const paths = [...appSource.matchAll(/<Route path="([^"]+)"/g)]
    .map(match => match[1])
    .filter(route => route.startsWith("/") && route !== "/" && route !== "*" && !route.includes(":"));
  return [...new Set(paths)].sort();
}

export async function buildMobileManifest({
  cwd = process.cwd(),
  assetRoot = path.join(cwd, "dist", "public"),
  providedRevision = process.env.BASIRA_SOURCE_SHA ?? "",
} = {}) {
  const gitRevision = tryGitRevision(cwd);
  const requested = providedRevision.trim().toLowerCase();
  if (requested && !shaPattern.test(requested)) throw Error("BASIRA_SOURCE_SHA is not a full Git SHA");
  if (requested && gitRevision && requested !== gitRevision) throw Error("Source SHA does not match checkout");
  const sourceRevision = requested || gitRevision;
  const routes = routeNames(await readFile(path.join(cwd, "client", "src", "App.tsx"), "utf8"));
  const nativeSource = await readFile(
    path.join(cwd, "ios", "DepthCalibrationLab", "DepthCalibrationLab", "BasiraFeatureCatalogue.swift"), "utf8"
  );
  const nativeRoutes = new Set([...nativeSource.matchAll(/case \.\w+: return "(\/[^"]+)"/g)].map(match => match[1]));
  // These two aliases intentionally reuse a single native catalogue item.
  const intentionalAliases = new Set(["/teacher-panel", "/settings/privacy-permissions"]);
  const missingNative = routes.filter(route => !nativeRoutes.has(route) && !intentionalAliases.has(route));
  if (missingNative.length > 0) {
    throw Error("Web routes missing from native feature catalogue: " + missingNative.join(", "));
  }
  const required = ["/navigation/vision", "/navigation", "/navigation/guidance", "/exam-demo", "/assistant", "/account", "/settings/voice"];
  for (const entry of required) {
    if (!routes.includes(entry)) throw Error("Required Basira route missing: " + entry);
  }
  const files = (await listFiles(assetRoot)).sort();
  if (!files.includes("index.html") || !files.some(file => file.endsWith(".js")))
    throw Error("Web bundle lacks index.html or JS assets");
  let totalBytes = 0;
  const assetEntries = [];
  for (const filename of files) {
    const full = path.join(assetRoot, filename);
    const stat = await lstat(full);
    if (!stat.isFile()) throw Error("Disallowed asset: " + filename);
    totalBytes += stat.size;
    assetEntries.push([filename, stat.size, await hashFile(full)]);
  }
  const assetDigest = createHash("sha256").update(JSON.stringify(assetEntries)).digest("hex");
  return {
    schemaVersion: 1,
    product: "basira",
    sourceRevision: sourceRevision || null,
    sourceVerified: Boolean(sourceRevision),
    webBundle: { assetCount: files.length, totalBytes, sha256: assetDigest,
      indexSha256: assetEntries.find(entry => entry[0] === "index.html")?.[2] },
    declaredRoutes: routes,
    disclaimer: "Build identity and route declarations only; no live feature or physical safety verification.",
  };
}

export async function writeMobileManifest(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const root = options.assetRoot ?? path.join(cwd, "dist", "public");
  const manifest = await buildMobileManifest({ ...options, cwd, assetRoot: root });
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, excludedFile), JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf8", flag: "w" });
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  writeMobileManifest().then(manifest => {
    console.log("Basira web build manifest:", manifest.sourceRevision ?? "source-not-verifiable",
                manifest.webBundle.assetCount, "assets");
  }).catch(error => {
    console.error("Basira web build manifest failed:", error.message);
    process.exitCode = 1;
  });
}
