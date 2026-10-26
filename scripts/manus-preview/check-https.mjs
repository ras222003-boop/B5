/** Read-only probe of a known NEW preview. Strict public PKI validation; no certificate bypass. */
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
export async function checkHttps(origin, username, password) {
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.hostname === "basira-ve3h8rof.manus.space"
  )
    throw Error("Provide the exact new preview HTTPS origin");
  const headers = {
    authorization:
      "Basic " + Buffer.from(username + ":" + password).toString("base64"),
  };
  const get = path =>
    fetch(origin + path, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
  const status = await get("/api/preview/status");
  if (!status.ok)
    throw Error(
      "Preview status rejected; inspect platform access/Host mapping, do not bypass TLS"
    );
  const receipt = await status.json();
  if (
    receipt.databaseConnected !== false ||
    receipt.cloudInferenceEnabled !== false
  )
    throw Error("Unexpected connected preview services");
  const page = await get("/navigation/vision");
  if (
    !page.ok ||
    !(page.headers.get("permissions-policy") ?? "").includes("camera=(self)")
  )
    throw Error("Page/camera policy not ready");
  const models = await get("/api/vision/object-quality/manifest").then(r =>
    r.json()
  );
  const results = {
    strictHttpsFetchPassed: true,
    sourceCommit: receipt.sourceCommit,
    pageLoaded: true,
    modelIds: (models.profiles ?? []).map(p => p.id),
    cameraPermissionPolicyReady: true,
    microphonePermissionPolicyReady: (
      page.headers.get("permissions-policy") ?? ""
    ).includes("microphone=(self)"),
    cameraHardwareTested: false,
    microphoneHardwareTested: false,
    iphoneTested: false,
    voiceOverTested: false,
    privateMediaUploaded: false,
  };
  for (const id of results.modelIds)
    if (!["objects-yolox-tiny", "objects-basira-v3"].includes(id))
      throw Error("Restricted model exposed");
  for (const path of [
    "/vision/onnx/ort-wasm-simd-threaded.wasm",
    "/vision/mediapipe/vision_wasm_module_internal.wasm",
  ]) {
    const r = await get(path);
    if (!r.ok || r.headers.get("content-type")?.includes("text/html"))
      throw Error("Runtime asset missing");
  }
  return results;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = await checkHttps(
    process.argv[2],
    process.env.BASIRA_PREVIEW_ACCESS_USERNAME ?? "",
    process.env.BASIRA_PREVIEW_ACCESS_PASSWORD ?? ""
  );
  if (process.argv[3])
    await writeFile(process.argv[3], JSON.stringify(result, null, 2), {
      flag: "wx",
    });
  console.log(JSON.stringify(result));
}
