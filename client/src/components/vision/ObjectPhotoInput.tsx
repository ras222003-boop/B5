import { useEffect, useRef, useState } from "react";
import type { VisionDetection, VisionProvider } from "@shared/vision";
import { openObjectProvider } from "@/lib/vision/workerObjectProvider";
import { DEFAULT_VISION_CONFIG } from "@/lib/vision/config";
import {
  analyzeObjectColor,
  sampleColorFrame,
  colorDescription,
} from "@/lib/vision/objectColors";
import { objectLabel } from "@/lib/vision/cocoLabels";
import type { VisionCopy } from "@/lib/vision/scene";
import type { ObjectQualityProfile } from "@shared/objectQuality";
import {describeObjectScene,imagePosition} from "@/lib/vision/objectSceneDescription";
import {colourForSpeech} from '@/lib/vision/colourAnnouncement';
export function ObjectPhotoInput({
  copy,
  objectsSpeech,
  colorsSpeech,
  cameraRunning,
  beforeAnalyze,
  announce,
  profile,
  capture,
}: {
  copy: VisionCopy;
  objectsSpeech: boolean;
  colorsSpeech: boolean;
  cameraRunning: boolean;
  beforeAnalyze: () => Promise<void>;
  announce: (text: string) => void;
  profile?: ObjectQualityProfile;
  capture?:()=>Promise<File|null>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    provider = useRef<VisionProvider | null>(null),
    generation = useRef(0),
    alive = useRef(true);
  const opening = useRef<AbortController | null>(null);
  const permitted = useRef(false);
  const [rows, setRows] = useState<VisionDetection[]>([]),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [rights, setRights] = useState(false),
    [milliseconds, setMilliseconds] = useState<number | null>(null);
  const [analysisId, setAnalysisId] = useState(0);
  const release = () => {
    generation.current++;
    opening.current?.abort();
    opening.current = null;
    void provider.current?.close();
    provider.current = null;
    if(alive.current)setMilliseconds(null);
    if (canvas.current) {
      canvas.current.width = 640;
      canvas.current.height = 480;
    }
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      release();
    };
  }, []);
  useEffect(() => {
    if (cameraRunning) {
      release();
      setRows([]);
      setNotice("");
      setBusy(false);
    }
  }, [cameraRunning]);
  const analyze = async (file: File) => {
    release();
    const run = generation.current;
    if (!permitted.current || !alive.current) return;
    setAnalysisId(run);
    setBusy(true);
    setRows([]);
    setNotice("جارٍ تحليل الصورة محليًا…");
    let url: string | null = null;
    try {
      await beforeAnalyze();
      if (run !== generation.current || !permitted.current || !alive.current)
        return;
      if (!file.type.startsWith("image/") || file.size > 32 * 1024 * 1024)
        throw new Error("اختر صورة مدعومة لا تتجاوز 32 MiB");
      url = URL.createObjectURL(file);
      const image = new Image();
      image.src = url;
      await image.decode();
      if (run !== generation.current || !alive.current) return;
      const target = canvas.current!,
        scale = Math.min(
          1,
          1280 / Math.max(image.naturalWidth, image.naturalHeight)
        );
      target.width = Math.round(image.naturalWidth * scale);
      target.height = Math.round(image.naturalHeight * scale);
      target
        .getContext("2d")!
        .drawImage(image, 0, 0, target.width, target.height);
      const abort = new AbortController();
      opening.current = abort;
      const opened = await openObjectProvider(
        DEFAULT_VISION_CONFIG,
        abort.signal,
        profile,
        Boolean(profile?.maskForStills)
      );
      opening.current = null;
      if (run !== generation.current || !alive.current) {
        await opened.provider.close();
        return;
      }
      provider.current = opened.provider;
      const capturedAt = performance.now(),
        pixels = sampleColorFrame(target, capturedAt, `photo-${run}`),
        started = performance.now();
      const detections = await provider.current.detect(target, capturedAt);
      if (run !== generation.current || !alive.current) return;
      const result = detections
        .filter(d => d.confidence >= (profile?.threshold ?? 0.65))
        .map(d => ({
          ...d,
          color:
            d.color?.timestamp === capturedAt
              ? d.color
              : pixels
                ? analyzeObjectColor(pixels, d, detections)
                : undefined,
        }));
      setRows(result);
      setMilliseconds(performance.now() - started);
      const ctx = target.getContext("2d")!;
      ctx.strokeStyle = "#fde68a";
      ctx.lineWidth = Math.max(2, target.width / 250);
      result.forEach((d, i) => {
        const b = d.boundingBox;
        ctx.strokeRect(
          b.x * target.width,
          b.y * target.height,
          b.width * target.width,
          b.height * target.height
        );
        ctx.font = `bold ${Math.max(16, target.width / 45)}px sans-serif`;
        const label = `${i + 1}: ${objectLabel(d, copy)} ${Math.round(d.confidence * 100)}%`,
          labelWidth = Math.min(
            target.width,
            ctx.measureText(label).width + 10
          ),
          x = Math.max(
            0,
            Math.min(b.x * target.width, target.width - labelWidth)
          ),
          y = Math.max(25, b.y * target.height);
        ctx.fillStyle = "#18181b";
        ctx.fillRect(x, y - 25, labelWidth, 30);
        ctx.fillStyle = "#fde68a";
        ctx.textAlign = "left";
        ctx.fillText(label, x + 4, y - 3);
      });
      const phrases = result
        .slice(0, 5)
        .map((d,index)=>{const colour=colorsSpeech?colourForSpeech(d,{now:capturedAt,live:false}):'';if(!objectsSpeech&&!colour)return '';return `${objectsSpeech?objectLabel(d,copy):`لون الجسم رقم ${index+1}`}${colour?` ${colour}`:''} ${imagePosition(d)}`;}).filter(Boolean);
      setNotice(
        "صورة ثابتة؛ درجات النموذج والألوان غير معايرة، ولا تمثل بثًا حيًا أو توجيهًا للمشي."
      );
      if (objectsSpeech || colorsSpeech){
        const description=copy.object.PERSON === "شخص" ? describeObjectScene(result,{now:capturedAt,objects:objectsSpeech,colors:colorsSpeech,relations:true,minimumScore:profile?.threshold??.65}) : phrases.length
            ? phrases.join("؛ ")
            : objectsSpeech?"لم يُكتشف جسم بدرجة كافية؛ لا يثبت ذلك خلو الصورة.":'';
        if(description)announce('وصف صورة ثابتة؛ '+description);
      }
    } catch (error) {
      if (run === generation.current && alive.current)
        setNotice(
          `تعذر التحليل: ${error instanceof Error ? error.message : "unknown"}`
        );
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (run === generation.current) {
        await provider.current?.close();
        provider.current = null;
        if (alive.current) setBusy(false);
      }
    }
  };
  return (
    <section
      className="space-y-3 rounded-xl border border-amber-300/40 bg-stone-900 p-4"
      aria-label="الأشياء والألوان من صورة"
      data-testid="object-photo-input"
      data-count={rows.length}
      data-analysis-id={analysisId}
    >
      <h2 className="text-xl font-bold">التعرف على الأشياء وألوانها من صورة</h2>
      <label className="flex min-h-12 gap-3">
        <input
          type="checkbox"
          checked={rights}
          onChange={e => {
            permitted.current = e.target.checked;
            setRights(e.target.checked);
            if (!e.target.checked) {
              release();
              setRows([]);
              setBusy(false);
            }
          }}
        />
        أؤكد صلاحية استخدام الصورة للاستدلال المحلي؛ لا تُضاف للتدريب.
      </label>
      <input
        aria-label="صورة للتعرف على الأشياء والألوان"
        type="file"
        accept="image/*"
        disabled={!rights || busy}
        onChange={e => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void analyze(file);
        }}
      />
      <p role="status">{notice}</p>
      {capture&&<><button type="button" className="min-h-12 rounded-lg border border-amber-300 px-4" disabled={!rights||busy||!cameraRunning} aria-describedby="object-local-capture-note" onClick={()=>void (async()=>{try{const file=await capture();if(file)await analyze(file);else setNotice('لا تتوفر لقطة حديثة من الكاميرا.');}catch{setNotice('تعذر التقاط الصورة محليًا.');}})()}>التقاط صورة ووصفها محليًا</button><p id="object-local-capture-note">يوقف البث ثم يحلل لقطة ثابتة محليًا؛ الوصف يخص الصورة الملتقطة ولا يمثل قراءة مباشرة.</p></>}
      {busy && (
        <button
          type="button"
          className="min-h-12 rounded-lg border border-amber-300 px-4"
          onClick={() => {
            release();
            setBusy(false);
            setRows([]);
            setNotice("أوقف تحليل الصورة وأغلقت موارده.");
          }}
        >
          إيقاف تحليل الصورة
        </button>
      )}
      <canvas
        ref={canvas}
        width={640}
        height={480}
        className="max-h-[60vh] w-full bg-black object-contain"
        aria-label="صورة ومربع مستقل لكل جسم"
      />
      <ol
        className="list-inside list-decimal"
        data-testid="photo-object-results"
      >
        {rows.map(d => (
          <li key={d.id}>
            {objectLabel(d, copy)} — درجة غير معايرة{" "}
            {Math.round(d.confidence * 100)}٪ —{" "}
            {copy.object.PERSON === "شخص" ? imagePosition(d) : copy.direction[d.horizontalDirection]} —{" "}
            {d.cocoClass === "person"
              ? "ألوان الملابس غير محددة"
              : colorDescription(d)}{" "}
            {d.objectMask && (
              <span>
                {" "}
                —{" "}
                {d.objectMask.accepted
                  ? "قناع آلي اجتاز فلاتر مبدئية؛ صحة اللون غير مثبتة"
                  : "قناع غير كافٍ لتحديد اللون"}
              </span>
            )}
            — مربع{" "}
            {Object.values(d.boundingBox)
              .map(n => n.toFixed(2))
              .join(" / ")}
          </li>
        ))}
      </ol>
      {milliseconds !== null && (
        <p>
          زمن الكشف وتحليل اللون: {milliseconds.toFixed(1)} ms. لون الصورة
          الواحدة تقدير دون تثبيت زمني.
        </p>
      )}
    </section>
  );
}
