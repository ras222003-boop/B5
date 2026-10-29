export interface CameraCaptureAttempt {
  readonly signal: AbortSignal;
}
const stopped = () => new DOMException("Camera session stopped", "AbortError");
const stopTracks = (stream: MediaStream) =>
  stream.getTracks().forEach(track => track.stop());

/** One owner for a pending permission request or live stream. */
export class CameraCaptureLifecycle {
  private attempt: CameraCaptureAttempt | null = null;
  private abort: AbortController | null = null;
  private currentStream: MediaStream | null = null;
  private detachEnded: (() => void) | null = null;
  get stream() {
    return this.currentStream;
  }
  begin(): CameraCaptureAttempt {
    this.stop();
    this.abort = new AbortController();
    return (this.attempt = { signal: this.abort.signal });
  }
  isCurrent(attempt: CameraCaptureAttempt) {
    return this.attempt === attempt && !attempt.signal.aborted;
  }
  adopt(
    attempt: CameraCaptureAttempt,
    stream: MediaStream,
    onEnded: () => void
  ): boolean {
    if (!this.isCurrent(attempt)) {
      stopTracks(stream);
      return false;
    }
    if (!stream.getVideoTracks().some(track => track.readyState === "live")) {
      stopTracks(stream);
      return false;
    }
    this.currentStream = stream;
    const ended = () => {
      if (!this.isCurrent(attempt) || this.currentStream !== stream) return;
      this.stop();
      onEnded();
    };
    const tracks = stream.getTracks();
    tracks.forEach(track => track.addEventListener("ended", ended));
    this.detachEnded = () =>
      tracks.forEach(track => track.removeEventListener("ended", ended));
    return true;
  }
  stop() {
    this.attempt = null;
    this.abort?.abort();
    this.abort = null;
    this.detachEnded?.();
    this.detachEnded = null;
    const stream = this.currentStream;
    this.currentStream = null;
    if (stream) stopTracks(stream);
  }
}

/** Cancellation and permission denial never trigger another camera attempt. */
export async function acquireCameraStream(
  signal: AbortSignal,
  request: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
  constraintsList: readonly MediaStreamConstraints[]
): Promise<MediaStream> {
  let lastError: unknown = new Error("camera_unavailable");
  for (const constraints of constraintsList) {
    if (signal.aborted) throw stopped();
    try {
      const stream = await request(constraints);
      if (signal.aborted) {
        stopTracks(stream);
        throw stopped();
      }
      return stream;
    } catch (error) {
      if (signal.aborted) throw stopped();
      lastError = error;
      const name = (error as { name?: string } | null)?.name;
      if (
        [
          "AbortError",
          "NotAllowedError",
          "PermissionDeniedError",
          "SecurityError",
        ].includes(name ?? "")
      )
        throw error;
    }
  }
  throw lastError;
}

/** Ready/play listeners belong to the attempt and are removed on stop. */
export function waitForCameraPlayback(
  video: HTMLVideoElement,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(stopped());
      return;
    }
    let settled = false,
      started = false;
    const events = [
      "loadedmetadata",
      "loadeddata",
      "canplay",
      "canplaythrough",
    ];
    const cleanup = () => {
      events.forEach(event => video.removeEventListener(event, onReady));
      video.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
      clearTimeout(timeout);
    };
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      error ? reject(error) : resolve();
    };
    const onAbort = () => finish(stopped());
    const onReady = async () => {
      if (started || signal.aborted) return;
      started = true;
      try {
        await video.play();
        finish(signal.aborted ? stopped() : undefined);
      } catch {
        finish(
          signal.aborted ? stopped() : new Error("camera_playback_failed")
        );
      }
    };
    const onError = () => finish(new Error("camera_playback_failed"));
    const timeout = setTimeout(
      () => finish(new Error("camera_ready_timeout")),
      10_000
    );
    signal.addEventListener("abort", onAbort, { once: true });
    events.forEach(event => video.addEventListener(event, onReady));
    video.addEventListener("error", onError);
    if (video.readyState >= 1) void onReady();
  });
}
