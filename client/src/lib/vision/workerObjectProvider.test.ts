import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VISION_CONFIG } from "./config";
import {
  openObjectProvider,
  WorkerObjectProvider,
} from "./workerObjectProvider";
import { MediaPipeVisionProvider } from "./providers";

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    super();
    FakeWorker.instances.push(this);
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  FakeWorker.instances = [];
});
const install = () => {
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("OffscreenCanvas", class {});
  vi.stubGlobal("createImageBitmap", vi.fn());
};
describe("object provider resource cancellation", () => {
  it("terminates a loading worker on cancellation without starting a fallback model", async () => {
    install();
    const abort = new AbortController(),
      fallback = vi.spyOn(MediaPipeVisionProvider, "open");
    const opening = openObjectProvider(DEFAULT_VISION_CONFIG, abort.signal);
    abort.abort();
    await expect(opening).rejects.toThrow("object_provider_cancelled");
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
  });
  it("closes a late main thread fallback if cancellation happened while loading", async () => {
    vi.stubGlobal("Worker", undefined);
    const close = vi.fn(async () => {}),
      abort = new AbortController();
    let ready!: (value: MediaPipeVisionProvider) => void;
    vi.spyOn(MediaPipeVisionProvider, "open").mockImplementation(
      () =>
        new Promise(resolve => {
          ready = resolve;
        })
    );
    const opening = openObjectProvider(DEFAULT_VISION_CONFIG, abort.signal);
    await Promise.resolve();
    abort.abort();
    ready({ close } as unknown as MediaPipeVisionProvider);
    await expect(opening).rejects.toThrow("object_provider_cancelled");
    expect(close).toHaveBeenCalledOnce();
  });
  it("detaches the opening abort listener once a worker is ready", async () => {
    install();
    const abort = new AbortController(),
      opening = WorkerObjectProvider.open(DEFAULT_VISION_CONFIG, abort.signal),
      worker = FakeWorker.instances[0];
    worker.dispatchEvent(
      new MessageEvent("message", { data: { kind: "ready" } })
    );
    const provider = await opening;
    abort.abort();
    expect(worker.terminate).not.toHaveBeenCalled();
    await provider.close();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
