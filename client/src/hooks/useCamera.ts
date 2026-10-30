import { useRef, useState, useCallback, useEffect } from "react";
import { ocrImageDimensions } from "@/lib/examImage";
import {
  CameraCaptureLifecycle,
  acquireCameraStream,
  waitForCameraPlayback,
} from "@/lib/cameraCaptureLifecycle";

export interface CameraErrorMessages {
  unsupported: string;
  permissionDenied: string;
  notFound: string;
  inUse: string;
  generic: (name: string) => string;
  videoElementMissing: string;
  playbackFailed: string;
}

/** Localized camera UI with generation-owned acquisition, playback and teardown. */
export function useCamera(messages: CameraErrorMessages) {
  const videoRef = useRef<HTMLVideoElement | null>(null),
    canvasRef = useRef<HTMLCanvasElement | null>(null);
  const owner = useRef(new CameraCaptureLifecycle()),
    starting = useRef(false);
  const [isActive, setIsActive] = useState(false),
    [error, setError] = useState<string | null>(null),
    [isStarting, setIsStarting] = useState(false);
  const stopCamera = useCallback(() => {
    owner.current.stop();
    starting.current = false;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsActive(false);
    setIsStarting(false);
  }, []);
  const startCamera = useCallback(async () => {
    if (starting.current) return;
    stopCamera();
    const attempt = owner.current.begin();
    starting.current = true;
    setError(null);
    setIsStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(messages.unsupported);
        return;
      }
      const stream = await acquireCameraStream(
        attempt.signal,
        constraints => navigator.mediaDevices.getUserMedia(constraints),
        [
          {
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 2560, min: 640 },
              height: { ideal: 1920, min: 480 },
            },
            audio: false,
          },
          {
            video: {
              facingMode: "environment",
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          },
          {
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          },
          { video: true, audio: false },
        ]
      );
      if (
        !owner.current.adopt(attempt, stream, () => {
          if (videoRef.current?.srcObject === stream)
            videoRef.current.srcObject = null;
          starting.current = false;
          setIsActive(false);
          setIsStarting(false);
        })
      ) {
        if (owner.current.isCurrent(attempt))
          throw new Error("camera_stream_ended");
        return;
      }
      const video = videoRef.current;
      if (!video) {
        stopCamera();
        setError(messages.videoElementMissing);
        return;
      }
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");
      await waitForCameraPlayback(video, attempt.signal);
      if (!owner.current.isCurrent(attempt) || video.srcObject !== stream)
        return;
      setIsActive(true);
    } catch (caught) {
      // An obsolete permission/playback callback owns no state or cleanup in a new run.
      if (!owner.current.isCurrent(attempt)) return;
      const name = (caught as { name?: string } | null)?.name ?? "Error";
      stopCamera();
      if (name === "AbortError") return;
      setError(
        ["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(
          name
        )
          ? messages.permissionDenied
          : ["NotFoundError", "DevicesNotFoundError"].includes(name)
            ? messages.notFound
            : ["NotReadableError", "TrackStartError"].includes(name)
              ? messages.inUse
              : caught instanceof Error && caught.message.startsWith("camera_")
                ? messages.playbackFailed
                : messages.generic(name)
      );
    } finally {
      if (owner.current.isCurrent(attempt)) {
        starting.current = false;
        setIsStarting(false);
      }
    }
  }, [messages, stopCamera]);

  const captureImage = useCallback((): string | null => {
    const video = videoRef.current,
      canvas = canvasRef.current,
      stream = owner.current.stream;
    if (
      !video ||
      !canvas ||
      !stream ||
      video.srcObject !== stream ||
      !stream.getVideoTracks().some(track => track.readyState === "live") ||
      video.readyState < 2 ||
      !video.videoWidth ||
      !video.videoHeight
    )
      return null;
    const { width, height } = ocrImageDimensions(
      video.videoWidth,
      video.videoHeight
    );
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.9);
  }, []);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) stopCamera();
    };
    window.addEventListener("basira:native-suspend", stopCamera);
    window.addEventListener("pagehide", stopCamera);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("basira:native-suspend", stopCamera);
      window.removeEventListener("pagehide", stopCamera);
      document.removeEventListener("visibilitychange", hidden);
      owner.current.stop();
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [stopCamera]);
  return {
    videoRef,
    canvasRef,
    isActive,
    isStarting,
    error,
    startCamera,
    stopCamera,
    captureImage,
  };
}
