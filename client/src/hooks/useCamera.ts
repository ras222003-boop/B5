import { useRef, useState, useCallback, useEffect } from "react";

export function useCamera() {
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
      setError("المتصفح لا يدعم الكاميرا. استخدم Chrome أو Safari على جهاز حديث.");
      setIsStarting(false);
      return;
    }

    // Try environment (rear) camera first, then fall back to any camera
    const constraintsList: MediaStreamConstraints[] = [
      {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920, min: 640 },
          height: { ideal: 1080, min: 480 },
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
          setError("يرجى السماح بالوصول إلى الكاميرا. اضغط على أيقونة الكاميرا في شريط العنوان وفعّل الصلاحية.");
        } else if (lastError.name === "NotFoundError" || lastError.name === "DevicesNotFoundError") {
          setError("لم يتم العثور على كاميرا. يمكنك رفع صورة بدلاً من ذلك.");
        } else if (lastError.name === "NotReadableError" || lastError.name === "TrackStartError") {
          setError("الكاميرا مستخدمة من تطبيق آخر. أغلق التطبيقات الأخرى وحاول مرة أخرى.");
        } else {
          setError(`حدث خطأ في تشغيل الكاميرا (${lastError.name}). يمكنك رفع صورة بدلاً من ذلك.`);
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
      setError("خطأ داخلي: عنصر الفيديو غير موجود.");
      return;
    }

    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");

    try {
      await new Promise<void>((resolve, reject) => {
        let resolved = false;

        const doResolve = async () => {
          if (resolved) return;
          resolved = true;
          try {
            await video.play();
            resolve();
          } catch (playErr: any) {
            // Autoplay blocked - still show video
            if (playErr.name === "NotAllowedError") {
              resolve(); // Video is ready even if autoplay is blocked
            } else {
              reject(playErr);
            }
          }
        };

        // Listen for multiple events to handle different browser behaviors
        const events = ["loadedmetadata", "loadeddata", "canplay", "canplaythrough"];
        const cleanup = () => {
          events.forEach(evt => video.removeEventListener(evt, doResolve));
        };

        events.forEach(evt => video.addEventListener(evt, () => {
          cleanup();
          doResolve();
        }, { once: true }));

        video.addEventListener("error", (e) => {
          cleanup();
          reject(new Error(`Video error: ${video.error?.message || "unknown"}`));
        }, { once: true });

        // If already has data, try immediately
        if (video.readyState >= 1) {
          cleanup();
          doResolve();
          return;
        }

        // Timeout after 10 seconds
        const timeout = setTimeout(() => {
          cleanup();
          // Try to play anyway even if events didn't fire
          doResolve();
        }, 10000);

        // Clear timeout on resolve
        const origResolve = resolve;
        // @ts-ignore
        resolve = (val?: any) => {
          clearTimeout(timeout);
          origResolve(val);
        };
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
          setError("تعذّر تشغيل الكاميرا. حاول رفع صورة بدلاً من ذلك.");
        }
      }
    } finally {
      setIsStarting(false);
    }
  }, [isStarting]);

  const captureImage = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) {
      console.warn("captureImage: video or canvas ref is null");
      return null;
    }

    // Ensure video has valid dimensions
    const width = video.videoWidth || video.clientWidth || 1280;
    const height = video.videoHeight || video.clientHeight || 720;

    if (!width || !height) {
      console.warn("captureImage: video has no dimensions yet");
      return null;
    }

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.92);
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
