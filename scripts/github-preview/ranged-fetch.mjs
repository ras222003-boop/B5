/** Preview-only bounded transport for pinned public binaries. Models still undergo their normal SHA-256 check. */
const sizes = {
  "api/vision/object-quality/assets/yolox/yolox_tiny.onnx": 20219662,
  "api/vision/object-quality/models/objects-basira-v3/assets/yolox/yolox_tiny.onnx": 20258925,
  "assets/ort-wasm-simd-threaded.jsep-B0T3yYHD.wasm": 21596019,
  "vision/efficientdet_lite0_int8.tflite": 4602795,
  "vision/mediapipe/vision_wasm_internal.wasm": 11756954,
  "vision/mediapipe/vision_wasm_module_internal.wasm": 11756972,
  "vision/mediapipe/vision_wasm_nosimd_internal.wasm": 10960242,
  "vision/onnx/ort-wasm-simd-threaded.jsep.wasm": 21596019,
  "vision/onnx/ort-wasm-simd-threaded.wasm": 11133407,
};
export function rangedAssetFetch(native, origin, base) {
  if (!/^\/[a-zA-Z0-9-]+\/$/.test(base))
    throw Error("Explicit project base required");
  return async (input, options = {}) => {
    const request = input instanceof Request ? input : null,
      url = new URL(request?.url ?? String(input), origin + base),
      method = (options.method ?? request?.method ?? "GET").toUpperCase(),
      path = url.pathname.slice(base.length),
      size = sizes[path];
    if (
      method !== "GET" ||
      url.origin !== origin ||
      !url.pathname.startsWith(base) ||
      url.search ||
      !size ||
      new Headers(options.headers ?? request?.headers).has("range")
    )
      return native(input, options);
    const bytes = new Uint8Array(size),
      signal = options.signal ?? request?.signal,
      chunk = 1_000_000;
    let next = 0;
    const read = async () => {
      while (next < size) {
        const start = next;
        next += chunk;
        const end = Math.min(size - 1, start + chunk - 1);
        for (let attempt = 0; attempt < 2; attempt++) {
          const controller = new AbortController(),
            abort = () => controller.abort(),
            timer = setTimeout(abort, 45000);
          signal?.addEventListener("abort", abort, { once: true });
          try {
            if (signal?.aborted) throw Error("preview_range_aborted");
            const headers = new Headers(options.headers ?? request?.headers);
            headers.set("Range", `bytes=${start}-${end}`);
            const r = await native(url.href, {
              ...options,
              method: "GET",
              headers,
              credentials: "omit",
              redirect: "error",
              signal: controller.signal,
            });
            if (
              r.status !== 206 ||
              r.headers.get("content-range") !== `bytes ${start}-${end}/${size}`
            ) {
              await r.body?.cancel();
              throw Error("preview_range_contract");
            }
            const part = new Uint8Array(await r.arrayBuffer());
            if (part.length !== end - start + 1)
              throw Error("preview_range_length");
            bytes.set(part, start);
            break;
          } catch (e) {
            if (attempt === 1 || signal?.aborted) throw e;
          } finally {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
          }
        }
      }
    };
    await Promise.all([read(), read()]);
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": path.endsWith(".wasm")
          ? "application/wasm"
          : "application/octet-stream",
        "Content-Length": String(size),
      },
    });
  };
}
