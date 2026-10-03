import { useRef, useState, useCallback, useEffect } from "react";
import { ocrImageDimensions } from "@/lib/examImage";

export interface CameraErrorMessages {
  unsupported: string;
  permissionDenied: string;
  notFound: string;
  inUse: string;
  generic: (name: string) => string;
  videoElementMissing: string;
  playbackFailed: string;
}

/**
 * Camera capture with errors supplied by the consuming localized UI.
 * Keeping the hook text-free lets its consumers control the visible language.
 */
export function useCamera(messages: CameraErrorMessages) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsActive(false);
    setIsStarting(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (isStarting) return;
    setError(null);
    setIsStarting(true);

    // Stop any existing stream first
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Check if getUserMedia is supported
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError(messages.unsupported);
      setIsStarting(false);
      return;
    }

    // Try environment (rear) camera first, then fall back to any camera
    const constraintsList: MediaStreamConstraints[] = [
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
    ];

    let stream: MediaStream | null = null;
    let lastError: any = null;

    for (const constraints of constraintsList) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        break;
      } catch (err: any) {
        lastError = err;
        // If permission denied, no need to try other constraints
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          break;
        }
      }
    }

    if (!stream) {
      setIsStarting(false);
      if (lastError) {
        if (lastError.name === "NotAllowedError" || lastError.name === "PermissionDeniedError") {
          setError(messages.permissionDenied);
        } else if (lastError.name === "NotFoundError" || lastError.name === "DevicesNotFoundError") {
          setError(messages.notFound);
        } else if (lastError.name === "NotReadableError" || lastError.name === "TrackStartError") {
          setError(messages.inUse);
        } else {
          setError(messages.generic(lastError.name));
        }
      }
      return;
    }

    streamRef.current = stream;

    // Attach stream to video element
    const video = videoRef.current;
    if (!video) {
      stream.getTracks().forEach((t) => t.stop());
      setIsStarting(false);
      setError(messages.videoElementMissing);
      return;
    }

    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");

    try {
      await new Promise<void>((resolve, reject) => {
        let started = false;
        let settled = false;
        const events = ["loadedmetadata", "loadeddata", "canplay", "canplaythrough"];
        const cleanup = () => {
          events.forEach(event => video.removeEventListener(event, onReady));
          video.removeEventListener("error", onError);
          window.clearTimeout(timeoutId);
        };
        const finish = (error?: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (error) reject(error);
          else resolve();
        };
        const onReady = async () => {
          if (started) return;
          started = true;
          try {
            await video.play();
            finish();
          } catch (playErr: any) {
            // A browser gesture may still start playback; keep the stream available.
            finish(playErr?.name === "NotAllowedError" ? undefined : playErr);
          }
        };
        const onError = () => finish(new Error(`Video error: ${video.error?.message || "unknown"}`));
        const timeoutId = window.setTimeout(() => finish(new Error("Camera stream did not become ready")), 10000);
        events.forEach(event => video.addEventListener(event, onReady));
        video.addEventListener("error", onError);
        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
          onReady();
        }
      });

      setIsActive(true);
    } catch (playErr: any) {
      console.error("Camera play error:", playErr);
      // Try autoplay without waiting
      try {
        await video.play();
        setIsActive(true);
      } catch {
        // If play fails, still show the stream (user may need to tap)
        if (video.srcObject) {
          setIsActive(true);
        } else {
          stream.getTracks().forEach((t) => t.stop());
          setError(messages.playbackFailed);
        }
      }
    } finally {
      setIsStarting(false);
    }
  }, [isStarting, messages]);

  const captureImage = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) {
      console.warn("captureImage: video or canvas ref is null");
      return null;
    }

    // A CSS-sized video can still have no frame; capturing then creates a blank image.
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    const { width, height } = ocrImageDimensions(video.videoWidth, video.videoHeight);

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.9);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

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
