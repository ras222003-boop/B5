export type MeterDiagnostic =
  | 'OFF' | 'WAITING_CAMERA' | 'MODEL_LOADING' | 'FRAME_PROCESSING' | 'LOW_LIGHT'
  | 'MODEL_NETWORK' | 'MODEL_HTTP' | 'MODEL_REDIRECT' | 'MODEL_HTML'
  | 'MODEL_CONTENT_TYPE' | 'MODEL_SIZE' | 'MODEL_CHECKSUM' | 'WASM_ASSET' | 'MODEL_INIT'
  | 'INFERENCE_FAILED' | 'FRAME_STALE' | 'NO_OBJECT_DETECTED'
  | 'LOW_CONFIDENCE' | 'NO_ALIGNED_DEPTH' | 'NO_OBJECT_DEPTH' | 'INVALID_MODEL_DEPTH'
  | 'DEPTH_INCONSISTENT' | 'OUT_OF_TARGET_RANGE' | 'READY_OBJECT' | 'READY_CENTER';

export class MeterModelError extends Error {
  constructor(public readonly code:MeterDiagnostic, public readonly httpStatus?:number) {
    super(code);
    this.name='MeterModelError';
  }
}

export function meterErrorCode(error:unknown,stage:'MODEL_INIT'|'INFERENCE_FAILED'):MeterDiagnostic {
  return error instanceof MeterModelError?error.code:stage;
}

/** A response redirected to an auth page is never an ONNX/WASM asset. */
export function checkAssetResponse(response:Response,kind:'model'|'manifest'|'wasm'|'module'):void {
  if(response.redirected||(typeof location!=='undefined'&&new URL(response.url,location.href).origin!==location.origin))
    throw new MeterModelError('MODEL_REDIRECT',response.status);
  if(!response.ok)throw new MeterModelError('MODEL_HTTP',response.status);
  const type=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
  if(type==='text/html'||type==='application/xhtml+xml')throw new MeterModelError('MODEL_HTML',response.status);
  const valid=kind==='model'
    ? !type||['application/octet-stream','application/x-onnx','application/onnx','binary/octet-stream'].includes(type)
    : kind==='manifest' ? type==='application/json'
    : kind==='wasm' ? !type||type==='application/wasm'||type==='application/octet-stream'
      : !type||['text/javascript','application/javascript','application/ecmascript','text/ecmascript'].includes(type);
  if(!valid)throw new MeterModelError(kind==='model'?'MODEL_CONTENT_TYPE':'WASM_ASSET',response.status);
}

const copy:Record<'ar'|'en'|'zh-CN',Record<MeterDiagnostic,string>>={
  ar:{
    OFF:'القياس متوقف.',WAITING_CAMERA:'بانتظار إطار واضح من الكاميرا.',MODEL_LOADING:'جارٍ تحميل نموذج العمق المتري.',
    FRAME_PROCESSING:'جارٍ تحليل إطار الكاميرا.',LOW_LIGHT:'الإضاءة ضعيفة؛ لا توجد قراءة صالحة.',
    MODEL_NETWORK:'تعذر الاتصال بملف النموذج.',MODEL_HTTP:'ملف النموذج غير متاح من الخادم.',
    MODEL_REDIRECT:'ملف النموذج يعيد التوجيه إلى صفحة أخرى؛ تحقق من تسجيل الدخول واستضافة الملفات.',
    MODEL_HTML:'استُرجعت صفحة HTML بدل ملف النموذج.',MODEL_CONTENT_TYPE:'نوع ملف النموذج غير صحيح.',
    MODEL_SIZE:'حجم ملف النموذج غير صحيح أو تنزيله ناقص.',MODEL_CHECKSUM:'ملف النموذج تالف أو لا يطابق الأوزان المترية المعتمدة.',WASM_ASSET:'ملفات تشغيل WASM غير متاحة أو تعيد صفحة بديلة.',
    MODEL_INIT:'تعذر تهيئة النموذج في هذا المتصفح.',INFERENCE_FAILED:'فشل استدلال العمق في هذا الإطار.',
    FRAME_STALE:'استغرق الاستدلال وقتًا طويلًا وأصبح الإطار قديمًا.',NO_OBJECT_DETECTED:'لم يتعرف الكاشف على جسم في الإطار.',
    LOW_CONFIDENCE:'ثقة التعرف على الجسم منخفضة.',NO_ALIGNED_DEPTH:'الصورة وخريطة العمق غير متزامنتين.',
    NO_OBJECT_DEPTH:'لا توجد قراءة عمق صالحة لهذا الجسم.',INVALID_MODEL_DEPTH:'قيم العمق ناقصة أو غير صالحة.',
    DEPTH_INCONSISTENT:'قيم العمق على السطح مختلفة؛ رُفضت القراءة.',OUT_OF_TARGET_RANGE:'العمق خارج المدى التجريبي 0.5 إلى 3 أمتار.',
    READY_OBJECT:'تتوفر قراءة تجريبية لجسم مرصود.',READY_CENTER:'تتوفر قراءة تجريبية لسطح منتصف الصورة.',
  },
  en:{
    OFF:'Measurement is off.',WAITING_CAMERA:'Waiting for a clear camera frame.',MODEL_LOADING:'Loading the metric depth model.',
    FRAME_PROCESSING:'Analyzing the camera frame.',LOW_LIGHT:'Light is too low for a valid reading.',
    MODEL_NETWORK:'Could not connect to the model file.',MODEL_HTTP:'The model file is unavailable on the server.',
    MODEL_REDIRECT:'The model file redirects to another page. Check sign-in and asset hosting.',
    MODEL_HTML:'An HTML page was returned instead of the model file.',MODEL_CONTENT_TYPE:'The model file has the wrong content type.',
    MODEL_SIZE:'The model file has the wrong size or an incomplete download.',MODEL_CHECKSUM:'The model bytes are damaged or do not match the approved metric weights.',WASM_ASSET:'WASM runtime files are unavailable or return another page.',
    MODEL_INIT:'The model could not initialize in this browser.',INFERENCE_FAILED:'Depth inference failed for this frame.',
    FRAME_STALE:'Inference took too long; this frame is stale.',NO_OBJECT_DETECTED:'The detector found no object in this frame.',
    LOW_CONFIDENCE:'Object detection confidence is too low.',NO_ALIGNED_DEPTH:'The image and depth map are not aligned.',
    NO_OBJECT_DEPTH:'No valid depth reading for this object.',INVALID_MODEL_DEPTH:'Depth values are missing or invalid.',
    DEPTH_INCONSISTENT:'Depth values across the surface disagree; reading rejected.',OUT_OF_TARGET_RANGE:'Depth is outside the experimental 0.5–3 metre range.',
    READY_OBJECT:'An experimental reading is available for a detected object.',READY_CENTER:'An experimental reading is available for the centre surface.',
  },
  'zh-CN':{
    OFF:'测距已关闭。',WAITING_CAMERA:'等待清晰的相机画面。',MODEL_LOADING:'正在加载公制深度模型。',
    FRAME_PROCESSING:'正在分析相机画面。',LOW_LIGHT:'光线不足，无法获得有效读数。',
    MODEL_NETWORK:'无法连接模型文件。',MODEL_HTTP:'服务器上的模型文件不可用。',
    MODEL_REDIRECT:'模型文件跳转到其他页面；请检查登录状态和文件托管。',
    MODEL_HTML:'返回的是 HTML 页面，而不是模型文件。',MODEL_CONTENT_TYPE:'模型文件的内容类型错误。',
    MODEL_SIZE:'模型文件大小错误或下载不完整。',MODEL_CHECKSUM:'模型文件损坏或与已验证的公制权重不符。',WASM_ASSET:'WASM 运行文件不可用或返回了其他页面。',
    MODEL_INIT:'此浏览器无法初始化模型。',INFERENCE_FAILED:'当前画面的深度推理失败。',
    FRAME_STALE:'推理耗时过长，画面已过期。',NO_OBJECT_DETECTED:'当前画面未识别到物体。',
    LOW_CONFIDENCE:'物体识别置信度过低。',NO_ALIGNED_DEPTH:'图像与深度图未同步。',
    NO_OBJECT_DEPTH:'该物体没有有效深度读数。',INVALID_MODEL_DEPTH:'深度值缺失或无效。',
    DEPTH_INCONSISTENT:'表面深度值不一致，读数已拒绝。',OUT_OF_TARGET_RANGE:'深度超出 0.5 至 3 米的实验范围。',
    READY_OBJECT:'已获得已识别物体的实验读数。',READY_CENTER:'已获得画面中心表面的实验读数。',
  },
};

export function meterDiagnosticText(code:MeterDiagnostic,language:string):string {
  return copy[language==='ar'?'ar':language==='zh-CN'?'zh-CN':'en'][code];
}

export function centerSurfaceLabel(language:string):string {
  return language==='ar'?'سطح منتصف الصورة':language==='zh-CN'?'画面中心表面':'Centre surface';
}
