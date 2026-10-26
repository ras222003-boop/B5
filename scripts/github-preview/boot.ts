import "./install-ranged";
import { previewReadUrl } from "./network-policy.mjs";
const base = import.meta.env.BASE_URL,
  origin = location.origin,
  originalFetch = globalThis.fetch.bind(globalThis);
const denied = (status: number, reason: string) =>
  new Response(
    JSON.stringify({
      error: reason,
      databaseConnected: false,
      mediaUploaded: false,
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
globalThis.fetch = async (input: RequestInfo | URL, options?: RequestInit) => {
  const result = previewReadUrl(input, options, origin, base);
  if (!result.allowed) return denied(result.status!, result.reason!);
  return originalFetch(result.url!, {
    ...options,
    method: result.method,
    credentials: "omit",
    redirect: "error",
  });
};
const open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (
  this: XMLHttpRequest,
  method: string,
  url: string | URL,
  ...rest: unknown[]
) {
  const result = previewReadUrl(String(url), { method }, origin, base);
  if (!result.allowed) throw Error(result.reason);
  return Reflect.apply(open, this, [method, result.url, ...rest]);
} as typeof open;
if (navigator.sendBeacon) navigator.sendBeacon = () => false;
// Native browser transcription can use a vendor server; microphone permission checks never start it.
for (const name of ["SpeechRecognition", "webkitSpeechRecognition"])
  if (name in window)
    Object.defineProperty(window, name, {
      value: undefined,
      configurable: false,
    });
// Preview settings only; the existing application and production storage are on different origins.
localStorage.setItem("basira-auto-meter-enabled-v1", "false");
localStorage.setItem("basira-auto-meter-speech-v1", "false");
