package sa.basira.depthlab;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.ImageFormat;
import android.media.Image;
import android.net.Uri;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.View;
import android.webkit.SslErrorHandler;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.net.http.SslError;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.google.ar.core.ArCoreApk;
import com.google.ar.core.Config;
import com.google.ar.core.Coordinates2d;
import com.google.ar.core.Frame;
import com.google.ar.core.Session;
import com.google.ar.core.TrackingState;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Collections;
import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/**
 * Hosts the existing Basira /navigation/vision page. Its only camera source is the
 * ARCore Session: RGB and optional depth are acquired from one Frame, then depth
 * is registered to the exact 640x480 RGB crop before either reaches JavaScript.
 * The web page controls RGB start/stop and the separate opt-in depth mode.
 */
public final class NativeVisionActivity extends Activity implements GLSurfaceView.Renderer {
    private static final int CAMERA_REQUEST = 92;
    private static final int RGB_WIDTH = 640, RGB_HEIGHT = 480;
    private static final int DEPTH_WIDTH = 64, DEPTH_HEIGHT = 48;
    private static final long FRAME_INTERVAL_MS = 400;
    private static final long FRAME_MAX_AGE_NS = 800_000_000L;
    private static final String BRIDGE_SCRIPT = """
        (() => {
          const native = window.BasiraAndroidFrames;
          if (!native || window.BasiraNativeFrames) return;
          let sequence = 0;
          const pending = new Map();
          native.onmessage = event => {
            let response;
            try { response = JSON.parse(event.data); } catch { return; }
            const request = pending.get(response.id);
            if (!request) return;
            pending.delete(response.id);
            if (response.ok) request.resolve(response.frame ?? null);
            else request.reject(new Error(response.error || 'native_depth_unavailable'));
          };
          const invoke = (action, enabled) => new Promise((resolve, reject) => {
            const id = ++sequence;
            pending.set(id, {resolve, reject});
            try { native.postMessage(JSON.stringify({id, action, enabled})); }
            catch (error) { pending.delete(id); reject(error); }
          });
          Object.defineProperty(window, 'BasiraNativeFrames', {
            value: Object.freeze({
              start: () => invoke('start'),
              setMeterEnabled: enabled => invoke('setMeterEnabled', Boolean(enabled)),
              stop: () => invoke('stop'),
              nextFrame: () => invoke('nextFrame')
            }), configurable: false
          });
        })();
        """;

    private final Object sessionLock = new Object();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            if (!running) return;
            glView.requestRender();
            mainHandler.postDelayed(this, FRAME_INTERVAL_MS);
        }
    };
    private GLSurfaceView glView;
    private WebView webView;
    private TextView failure;
    private Uri pageUri;
    private String allowedOrigin;
    private Session session;
    private volatile boolean running;
    private volatile boolean meterEnabled;
    private volatile int meterGeneration;
    private volatile JSONObject latestFrame;
    private volatile long latestFrameAtNs;
    private long previousFrameTimestampNs;
    private volatile int cameraTexture;
    private boolean installingArCore;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        pageUri = Uri.parse(BuildConfig.BASIRA_VISION_URL);
        if (!"https".equals(pageUri.getScheme()) || pageUri.getHost() == null ||
                pageUri.getHost().endsWith(".example") || pageUri.getPort() != -1 ||
                !"/navigation/vision".equals(pageUri.getPath()) ||
                pageUri.getQuery() != null || pageUri.getFragment() != null) {
            showFatal("اضبط basiraVisionUrl على صفحة HTTPS المنشورة /navigation/vision قبل بناء التطبيق.");
            return;
        }
        allowedOrigin = "https://" + pageUri.getHost().toLowerCase();
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
                !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            showFatal("يلزم تحديث Android System WebView لدعم جسر الكاميرا الآمن.");
            return;
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        glView = new GLSurfaceView(this);
        glView.setEGLContextClientVersion(2);
        glView.setRenderer(this);
        glView.setRenderMode(GLSurfaceView.RENDERMODE_WHEN_DIRTY);
        root.addView(glView, new FrameLayout.LayoutParams(-1, -1));
        webView = new WebView(this);
        configureWebView(webView);
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        webView.loadUrl(pageUri.toString());
    }

    private void showFatal(String message) {
        failure = new TextView(this);
        failure.setText(message);
        failure.setTextSize(20);
        failure.setTextColor(Color.WHITE);
        failure.setPadding(30, 80, 30, 30);
        failure.setContentDescription(message);
        setContentView(failure);
    }

    private void configureWebView(WebView web) {
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                Uri target = request.getUrl();
                return !"https".equals(target.getScheme()) ||
                        !pageUri.getHost().equalsIgnoreCase(target.getHost()) || target.getPort() != -1;
            }
            @Override public void onPageStarted(WebView view, String url, Bitmap icon) {
                stopSensor();
            }
            @Override public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                super.doUpdateVisitedHistory(view, url, isReload);
                if (!isVisionPage(url)) stopSensor();
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                stopSensor();
            }
        });
        WebViewCompat.addWebMessageListener(web, "BasiraAndroidFrames",
                Collections.singleton(allowedOrigin),
                (view, message, sourceOrigin, isMainFrame, replyProxy) ->
                        onBridgeMessage(message, sourceOrigin, isMainFrame, replyProxy));
        WebViewCompat.addDocumentStartJavaScript(web, BRIDGE_SCRIPT,
                Collections.singleton(allowedOrigin));
    }

    private void onBridgeMessage(WebMessageCompat message, Uri sourceOrigin,
                                 boolean isMainFrame, JavaScriptReplyProxy reply) {
        int id = -1;
        try {
            JSONObject request = new JSONObject(message.getData());
            id = request.getInt("id");
            if (!isMainFrame || !isAllowedOrigin(sourceOrigin) ||
                    webView == null || !isVisionPage(webView.getUrl())) {
                respond(reply, id, false, null, "origin_not_allowed");
                return;
            }
            String action = request.getString("action");
            switch (action) {
                case "start":
                    startSensor(reply, id);
                    return;
                case "setMeterEnabled":
                    setMeterEnabled(request.optBoolean("enabled", false), reply, id);
                    return;
                case "stop":
                    stopSensor();
                    respond(reply, id, true, null, null);
                    return;
                case "nextFrame":
                    JSONObject frame = latestFrame;
                    if (!running || System.nanoTime() - latestFrameAtNs > FRAME_MAX_AGE_NS) frame = null;
                    respond(reply, id, true, frame, null);
                    return;
                default:
                    respond(reply, id, false, null, "unknown_action");
            }
        } catch (Exception error) {
            respond(reply, id, false, null, "invalid_request");
        }
    }

    private boolean isAllowedOrigin(Uri origin) {
        return origin != null && "https".equalsIgnoreCase(origin.getScheme()) &&
                pageUri.getHost().equalsIgnoreCase(origin.getHost()) &&
                (origin.getPort() == -1 || origin.getPort() == 443);
    }

    private boolean isVisionPage(String rawUrl) {
        if (rawUrl == null) return false;
        Uri location = Uri.parse(rawUrl);
        String path = location.getPath();
        return isAllowedOrigin(location) &&
                ("/navigation/vision".equals(path) || "/navigation/vision/".equals(path));
    }

    private void respond(JavaScriptReplyProxy reply, int id, boolean ok,
                         JSONObject frame, String error) {
        try {
            JSONObject response = new JSONObject().put("id", id).put("ok", ok);
            if (frame != null) response.put("frame", frame);
            if (error != null) response.put("error", error);
            reply.postMessage(response.toString());
        } catch (Exception ignored) { /* Browser was closed. */ }
    }

    private void startSensor(JavaScriptReplyProxy reply, int id) {
        if (running) { respond(reply, id, true, null, null); return; }
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_REQUEST);
            respond(reply, id, false, null, "camera_permission_required");
            return;
        }
        try {
            ArCoreApk.InstallStatus status = ArCoreApk.getInstance().requestInstall(this, !installingArCore);
            if (status == ArCoreApk.InstallStatus.INSTALL_REQUESTED) {
                installingArCore = true;
                respond(reply, id, false, null, "arcore_install_required");
                return;
            }
            synchronized (sessionLock) {
                session = new Session(this);
                Config config = session.getConfig();
                config.setDepthMode(Config.DepthMode.DISABLED);
                config.setUpdateMode(Config.UpdateMode.LATEST_CAMERA_IMAGE);
                session.configure(config);
                session.resume();
                running = true;
                meterEnabled = false;
                previousFrameTimestampNs = 0;
                latestFrame = null;
                latestFrameAtNs = 0;
            }
            mainHandler.removeCallbacks(ticker);
            mainHandler.post(ticker);
            respond(reply, id, true, null, null);
        } catch (Exception error) {
            stopSensor();
            respond(reply, id, false, null, "arcore_start_failed");
        }
    }

    private void setMeterEnabled(boolean enabled, JavaScriptReplyProxy reply, int id) {
        if (!running) { respond(reply, id, false, null, "camera_not_running"); return; }
        if (enabled == meterEnabled) { respond(reply, id, true, null, null); return; }
        // Hide all prior measurements before waiting for an in-flight RGB encode.
        meterGeneration++;
        meterEnabled = false;
        latestFrame = null;
        latestFrameAtNs = 0;
        try {
            synchronized (sessionLock) {
                if (session == null) throw new IllegalStateException("session_closed");
                if (enabled && !session.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) {
                    respond(reply, id, false, null, "arcore_depth_unsupported");
                    return;
                }
                // Clear the previous reading before reconfiguring the AR session.
                session.pause();
                Config config = session.getConfig();
                config.setDepthMode(enabled ? Config.DepthMode.AUTOMATIC : Config.DepthMode.DISABLED);
                session.configure(config);
                session.resume();
                previousFrameTimestampNs = 0;
                meterEnabled = enabled;
            }
            respond(reply, id, true, null, null);
        } catch (Exception error) {
            // A failed depth reconfiguration should leave object recognition
            // running on RGB whenever ARCore can recover in disabled mode.
            boolean rgbRecovered = false;
            synchronized (sessionLock) {
                if (session != null) {
                    try {
                        session.pause();
                        Config rgb = session.getConfig();
                        rgb.setDepthMode(Config.DepthMode.DISABLED);
                        session.configure(rgb);
                        session.resume();
                        previousFrameTimestampNs = 0;
                        rgbRecovered = true;
                    } catch (Exception ignored) { }
                }
            }
            if (!rgbRecovered) stopSensor();
            respond(reply, id, false, null, "arcore_depth_configuration_failed");
        }
    }

    private void stopSensor() {
        running = false;
        meterGeneration++;
        meterEnabled = false;
        latestFrame = null;
        latestFrameAtNs = 0;
        mainHandler.removeCallbacks(ticker);
        synchronized (sessionLock) {
            if (session != null) {
                try { session.pause(); } catch (Exception ignored) { }
                session.close();
                session = null;
            }
            previousFrameTimestampNs = 0;
        }
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        // A fresh user action in Basira Vision starts the camera after permission is granted.
        if (code == CAMERA_REQUEST && (results.length == 0 || results[0] != PackageManager.PERMISSION_GRANTED)) {
            stopSensor();
        }
    }

    @Override protected void onResume() {
        super.onResume();
        if (glView != null) glView.onResume();
    }

    @Override protected void onPause() {
        stopSensor();
        if (glView != null) glView.onPause();
        super.onPause();
    }

    @Override protected void onDestroy() {
        stopSensor();
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @Override public void onSurfaceCreated(GL10 gl, EGLConfig config) {
        int[] texture = new int[1];
        GLES20.glGenTextures(1, texture, 0);
        cameraTexture = texture[0];
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, cameraTexture);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
    }

    @Override public void onSurfaceChanged(GL10 gl, int width, int height) {
        GLES20.glViewport(0, 0, width, height);
    }

    @Override public void onDrawFrame(GL10 gl) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);
        synchronized (sessionLock) {
            if (!running || session == null || cameraTexture == 0) return;
            int generation = meterGeneration;
            try {
                session.setCameraTextureName(cameraTexture);
                session.setDisplayGeometry(getWindowManager().getDefaultDisplay().getRotation(),
                        Math.max(1, glView.getWidth()), Math.max(1, glView.getHeight()));
                Frame frame = session.update();
                long stamp = frame.getTimestamp();
                if (stamp <= 0 || stamp == previousFrameTimestampNs) return;
                previousFrameTimestampNs = stamp;
                try (Image camera = frame.acquireCameraImage()) {
                    if (camera.getTimestamp() != stamp || camera.getFormat() != ImageFormat.YUV_420_888) {
                        latestFrame = null;
                        return;
                    }
                    CameraCrop crop = CameraCrop.of(camera);
                    if (crop == null) { latestFrame = null; return; }
                    String imageBase64 = encodeCameraJpeg(camera, crop);
                    if (imageBase64 == null) { latestFrame = null; return; }
                    JSONObject payload = rgbPayload(stamp, camera, crop, imageBase64);
                    if (meterEnabled && frame.getCamera().getTrackingState() == TrackingState.TRACKING &&
                            session.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) {
                        try (Image depth = frame.acquireDepthImage16Bits()) {
                            // ARCore may return a cached depth image from an earlier frame.
                            // Exact timestamp equality is required for object-level metres.
                            if (depth.getTimestamp() == stamp) {
                                JSONArray values = registeredDepth(frame, depth, crop);
                                if (values != null) {
                                    payload.put("depthEnabled", true);
                                    payload.put("alignedToCameraFrame", true);
                                    payload.put("rawDepthFresh", true);
                                    payload.put("depthWidth", DEPTH_WIDTH);
                                    payload.put("depthHeight", DEPTH_HEIGHT);
                                    payload.put("values", values);
                                    payload.put("validCoverage", coverage(values));
                                    payload.put("depthTimestampNs", Long.toString(depth.getTimestamp()));
                                }
                            }
                        } catch (Exception ignored) { /* RGB remains available. */ }
                    }
                    if (running && generation == meterGeneration) {
                        latestFrame = payload;
                        latestFrameAtNs = System.nanoTime();
                    }
                }
            } catch (Exception error) {
                latestFrame = null;
                latestFrameAtNs = 0;
            }
        }
    }

    private static JSONObject rgbPayload(long stamp, Image camera, CameraCrop crop,
                                         String imageBase64) throws Exception {
        return new JSONObject()
                .put("frameId", "arcore-" + stamp)
                .put("nativeTimestampMs", stamp / 1_000_000.0)
                .put("source", "ARCORE_DEPTH")
                .put("capturedWithNativeSession", true)
                .put("alignedToCameraFrame", false)
                .put("rawDepthFresh", false)
                .put("depthEnabled", false)
                .put("cameraWidth", RGB_WIDTH).put("cameraHeight", RGB_HEIGHT)
                .put("sourceCameraWidth", camera.getWidth()).put("sourceCameraHeight", camera.getHeight())
                .put("cameraCropX", crop.x).put("cameraCropY", crop.y)
                .put("cameraCropWidth", crop.width).put("cameraCropHeight", crop.height)
                .put("imageBase64", imageBase64)
                .put("depthWidth", 0).put("depthHeight", 0)
                .put("values", new JSONArray()).put("validCoverage", 0)
                .put("imageRotationDegrees", 0).put("depthRotationDegrees", 0)
                .put("registrationMethod", "ARCORE_IMAGE_PIXELS_TO_TEXTURE_NORMALIZED");
    }

    private static final class CameraCrop {
        final int x, y, width, height;
        private CameraCrop(int x, int y, int width, int height) {
            this.x=x; this.y=y; this.width=width; this.height=height;
        }
        static CameraCrop of(Image image) {
            int w=image.getWidth(), h=image.getHeight();
            if (w < 320 || h < 240 || w <= h) return null;
            int cropW=Math.min(w, h*4/3);
            int cropH=cropW*3/4;
            return new CameraCrop((w-cropW)/2, (h-cropH)/2, cropW, cropH);
        }
    }

    /** JPEG pixels are sampled from the native YUV image without EXIF rotation. */
    private static String encodeCameraJpeg(Image image, CameraCrop crop) {
        Bitmap bitmap = null;
        try {
            Image.Plane[] p=image.getPlanes();
            ByteBuffer y=p[0].getBuffer(), u=p[1].getBuffer(), v=p[2].getBuffer();
            int[] pixels=new int[RGB_WIDTH*RGB_HEIGHT];
            for (int row=0;row<RGB_HEIGHT;row++) {
                int sy=crop.y+Math.min(crop.height-1,(int)((row+.5)*crop.height/RGB_HEIGHT));
                for (int col=0;col<RGB_WIDTH;col++) {
                    int sx=crop.x+Math.min(crop.width-1,(int)((col+.5)*crop.width/RGB_WIDTH));
                    int yy=y.get(sy*p[0].getRowStride()+sx*p[0].getPixelStride())&0xff;
                    int uu=u.get((sy/2)*p[1].getRowStride()+(sx/2)*p[1].getPixelStride())&0xff;
                    int vv=v.get((sy/2)*p[2].getRowStride()+(sx/2)*p[2].getPixelStride())&0xff;
                    int c=yy-16, d=uu-128, e=vv-128;
                    int red=clamp((298*c+409*e+128)>>8);
                    int green=clamp((298*c-100*d-208*e+128)>>8);
                    int blue=clamp((298*c+516*d+128)>>8);
                    pixels[row*RGB_WIDTH+col]=Color.rgb(red,green,blue);
                }
            }
            bitmap=Bitmap.createBitmap(pixels,RGB_WIDTH,RGB_HEIGHT,Bitmap.Config.ARGB_8888);
            ByteArrayOutputStream out=new ByteArrayOutputStream(100_000);
            if (!bitmap.compress(Bitmap.CompressFormat.JPEG,70,out)) return null;
            return Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP);
        } catch (Exception error) { return null; }
        finally { if (bitmap != null) bitmap.recycle(); }
    }

    private static int clamp(int value) { return Math.max(0, Math.min(255,value)); }

    /**
     * Google ARCore's depth raster is in texture coordinates, not in CPU image
     * pixels. Reproject every output depth pixel from the actual cropped RGB CPU
     * image through Frame.transformCoordinates2d before sampling depth.
     */
    private static JSONArray registeredDepth(Frame frame, Image depth, CameraCrop crop) {
        if (depth.getWidth() < 32 || depth.getHeight() < 24 || depth.getPlanes().length != 1) return null;
        try {
            float[] cpuPoints=new float[DEPTH_WIDTH*DEPTH_HEIGHT*2];
            float[] uvPoints=new float[cpuPoints.length];
            for (int y=0;y<DEPTH_HEIGHT;y++) for (int x=0;x<DEPTH_WIDTH;x++) {
                int i=(y*DEPTH_WIDTH+x)*2;
                cpuPoints[i]=(float)(crop.x+(x+.5)*crop.width/DEPTH_WIDTH);
                cpuPoints[i+1]=(float)(crop.y+(y+.5)*crop.height/DEPTH_HEIGHT);
            }
            frame.transformCoordinates2d(Coordinates2d.IMAGE_PIXELS, cpuPoints,
                    Coordinates2d.TEXTURE_NORMALIZED, uvPoints);
            Image.Plane plane=depth.getPlanes()[0];
            ByteBuffer bytes=plane.getBuffer().duplicate().order(ByteOrder.LITTLE_ENDIAN);
            JSONArray values=new JSONArray();
            int valid=0;
            for (int i=0;i<DEPTH_WIDTH*DEPTH_HEIGHT;i++) {
                float u=uvPoints[2*i], v=uvPoints[2*i+1];
                double meters=0;
                if (Float.isFinite(u) && Float.isFinite(v) && u>=0 && u<1 && v>=0 && v<1) {
                    int dx=Math.min(depth.getWidth()-1,(int)(u*depth.getWidth()));
                    int dy=Math.min(depth.getHeight()-1,(int)(v*depth.getHeight()));
                    int address=dy*plane.getRowStride()+dx*plane.getPixelStride();
                    if (address>=0 && address+1<bytes.limit()) {
                        int mm=Short.toUnsignedInt(bytes.getShort(address));
                        if (mm>=500 && mm<=5000) { meters=mm/1000.0; valid++; }
                    }
                }
                values.put(meters);
            }
            return valid >= DEPTH_WIDTH*DEPTH_HEIGHT*.70 ? values : null;
        } catch (Exception error) { return null; }
    }

    private static double coverage(JSONArray values) {
        int valid=0;
        for (int i=0;i<values.length();i++) if (values.optDouble(i,0)>0) valid++;
        return (double)valid/values.length();
    }
}
