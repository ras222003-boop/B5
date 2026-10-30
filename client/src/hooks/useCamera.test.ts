import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Minimal mount harness: effects run after refs attach, and state writes are
// observable without a browser granting a real camera permission.
const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  effects: [] as (() => void | (() => void))[],
}));
vi.mock("react", () => ({
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => {
    const index = hooks.states.push(value) - 1;
    return [
      value,
      (next: unknown) => {
        hooks.states[index] = next;
      },
    ];
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void)) => {
    hooks.effects.push(effect);
  },
}));
import { useCamera } from "./useCamera";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function fakeStream() {
  const track = Object.assign(new EventTarget(), {
    readyState: "live",
    stop: vi.fn(() => {
      track.readyState = "ended";
    }),
  });
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
}
const messages = {
  unsupported: "unsupported",
  permissionDenied: "denied",
  notFound: "missing",
  inUse: "busy",
  generic: (name: string) => name,
  videoElementMissing: "no-video",
  playbackFailed: "playback-failed",
};
function mount(request: ReturnType<typeof vi.fn>) {
  const page = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: request } });
  const camera = useCamera(messages);
  const video = Object.assign(new EventTarget(), {
    srcObject: null as MediaStream | null,
    readyState: 2,
    videoWidth: 1280,
    videoHeight: 720,
    muted: false,
    playsInline: false,
    setAttribute: vi.fn(),
    play: vi.fn(async () => {}),
  });
  camera.videoRef.current = video as unknown as HTMLVideoElement;
  const cleanups = hooks.effects.map(effect => effect());
  return {
    camera,
    video,
    page,
    unmount: () => cleanups.forEach(cleanup => cleanup?.()),
    state: () => ({
      active: hooks.states[0],
      error: hooks.states[1],
      starting: hooks.states[2],
    }),
  };
}
beforeEach(() => {
  hooks.states.length = 0;
  hooks.effects.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("camera capture hook cancellation and native suspension", () => {
  it("releases permission granted after Stop without attaching or activating it", async () => {
    const permission = deferred<MediaStream>(),
      old = fakeStream();
    const { camera, video, state, unmount } = mount(
      vi.fn(() => permission.promise)
    );
    const start = camera.startCamera();
    camera.stopCamera();
    permission.resolve(old.stream);
    await start;
    expect(old.track.stop).toHaveBeenCalledOnce();
    expect(video.play).not.toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
    expect(state()).toEqual({ active: false, starting: false, error: null });
    unmount();
  });

  it.each(["AbortError", "NotAllowedError", "SecurityError"])(
    "never retries %s with fallback constraints",
    async name => {
      const request = vi
        .fn()
        .mockRejectedValue(new DOMException("stopped or denied", name));
      const { camera, state, unmount } = mount(request);
      await camera.startCamera();
      expect(request).toHaveBeenCalledOnce();
      expect(state().active).toBe(false);
      expect(state().error).toBe(name === "AbortError" ? null : "denied");
      unmount();
    }
  );

  it("retries an unsupported constraint while the same attempt is still active", async () => {
    const live = fakeStream();
    const request = vi
      .fn()
      .mockRejectedValueOnce(
        new DOMException("constraint", "OverconstrainedError")
      )
      .mockResolvedValue(live.stream);
    const { camera, state, unmount } = mount(request);
    await camera.startCamera();
    expect(request).toHaveBeenCalledTimes(2);
    expect(state().active).toBe(true);
    unmount();
    expect(live.track.stop).toHaveBeenCalledOnce();
  });

  it("an obsolete acquisition rejection cannot clean up a newer live stream", async () => {
    const old = deferred<MediaStream>(),
      next = fakeStream();
    const request = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(next.stream);
    const { camera, video, state, unmount } = mount(request);
    const first = camera.startCamera();
    camera.stopCamera();
    await camera.startCamera();
    old.reject(new Error("late failure"));
    await first;
    expect(request).toHaveBeenCalledTimes(2);
    expect(video.srcObject).toBe(next.stream);
    expect(state()).toEqual({ active: true, starting: false, error: null });
    expect(next.track.stop).not.toHaveBeenCalled();
    unmount();
  });

  it("an obsolete playback rejection cannot clear a newer pending startup flag", async () => {
    const old = fakeStream(),
      next = fakeStream(),
      play = deferred<void>(),
      permission = deferred<MediaStream>();
    const request = vi
      .fn()
      .mockResolvedValueOnce(old.stream)
      .mockReturnValueOnce(permission.promise);
    const { camera, video, state, unmount } = mount(request);
    video.play.mockReturnValueOnce(play.promise);
    const first = camera.startCamera();
    await Promise.resolve();
    await Promise.resolve();
    expect(video.play).toHaveBeenCalledOnce();
    camera.stopCamera();
    const second = camera.startCamera();
    play.reject(new Error("late playback"));
    await first;
    expect(state().starting).toBe(true);
    permission.resolve(next.stream);
    await second;
    expect(video.srcObject).toBe(next.stream);
    expect(state().active).toBe(true);
    expect(next.track.stop).not.toHaveBeenCalled();
    unmount();
  });

  it("a system-ended track clears active state and the capture source", async () => {
    const live = fakeStream();
    const { camera, video, state, unmount } = mount(
      vi.fn().mockResolvedValue(live.stream)
    );
    await camera.startCamera();
    live.track.readyState = "ended";
    live.track.dispatchEvent(new Event("ended"));
    expect(state().active).toBe(false);
    expect(video.srcObject).toBeNull();
    expect(camera.captureImage()).toBeNull();
    unmount();
  });

  it.each(["basira:native-suspend", "pagehide", "visibilitychange"])(
    "stops on %s and never resumes on foreground",
    async event => {
      const live = fakeStream(),
        request = vi.fn().mockResolvedValue(live.stream);
      const { camera, video, page, state, unmount } = mount(request);
      await camera.startCamera();
      if (event === "visibilitychange") {
        page.hidden = true;
        page.dispatchEvent(new Event(event));
      } else window.dispatchEvent(new Event(event));
      expect(live.track.stop).toHaveBeenCalledOnce();
      expect(video.srcObject).toBeNull();
      expect(state().active).toBe(false);
      page.hidden = false;
      page.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("basira:native-resume"));
      await Promise.resolve();
      expect(request).toHaveBeenCalledOnce();
      expect(state().active).toBe(false);
      unmount();
    }
  );

  it("unmount invalidates an unresolved permission request", async () => {
    const permission = deferred<MediaStream>(),
      late = fakeStream();
    const { camera, video, unmount } = mount(vi.fn(() => permission.promise));
    const start = camera.startCamera();
    unmount();
    permission.resolve(late.stream);
    await start;
    expect(late.track.stop).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(video.play).not.toHaveBeenCalled();
  });

  it("reports failed playback and releases the stream instead of claiming active capture", async () => {
    const live = fakeStream();
    const { camera, video, state, unmount } = mount(
      vi.fn().mockResolvedValue(live.stream)
    );
    video.play.mockRejectedValueOnce(
      new DOMException("blocked", "NotAllowedError")
    );
    await camera.startCamera();
    expect(state()).toEqual({
      active: false,
      starting: false,
      error: "playback-failed",
    });
    expect(live.track.stop).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    unmount();
  });
});
