/** Fail closed before constructing/sending any camera POST. A static preview has no writable/cloud API. */
export function previewReadUrl(input, options, origin, base) {
  const inherited =
    input && typeof input === "object"
      ? "method" in input
        ? input.method
        : undefined
      : undefined;
  const method = String(options?.method ?? inherited ?? "GET").toUpperCase();
  if (!["GET", "HEAD"].includes(method))
    return { allowed: false, status: 405, reason: "PREVIEW_WRITES_DISABLED" };
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
    origin
  );
  if (url.origin !== origin)
    return {
      allowed: false,
      status: 403,
      reason: "PREVIEW_EXTERNAL_REQUEST_DISABLED",
    };
  if (/^\/(api|vision)(?:\/|$)/.test(url.pathname))
    url.pathname = base + url.pathname.slice(1);
  if (!url.pathname.startsWith(base))
    return {
      allowed: false,
      status: 403,
      reason: "PREVIEW_OUTSIDE_PROJECT_DISABLED",
    };
  if (
    url.pathname.startsWith(base + "api/") &&
    !url.pathname.startsWith(base + "api/vision/object-quality/") &&
    !["api/vision/experimental-models", "api/preview/status"].some(
      p => url.pathname === base + p
    )
  )
    return {
      allowed: false,
      status: 503,
      reason: "NO_DATABASE_OR_CLOUD_BACKEND",
    };
  return { allowed: true, url: url.href, method };
}
