package sa.basira.depthlab;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.Image;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.os.Bundle;
import android.os.SystemClock;
import android.speech.tts.TextToSpeech;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.google.ar.core.ArCoreApk;
import com.google.ar.core.Camera;
import com.google.ar.core.Config;
import com.google.ar.core.Coordinates2d;
import com.google.ar.core.Frame;
import com.google.ar.core.Session;
import com.google.ar.core.TrackingState;
import com.google.ar.core.exceptions.NotYetAvailableException;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.Arrays;
import java.util.Locale;
import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/**
 * Basira research-only centre-surface distance meter for ARCore Depth devices.
 * Never determines whether a walking route, stairs, or pavement is safe.
 * Depth is supplied by ARCore in millimetres and converted to metres.
 */
public final class MainActivity extends Activity implements GLSurfaceView.Renderer {
    private static final int CAMERA_REQUEST = 91;
    private GLSurfaceView glView;
    private TextView status;
    private TextView reading;
    private Session session;
    private TextToSpeech tts;
    private boolean installRequested = false;
    private volatile boolean configured = false;
    private volatile double lastMeters = Double.NaN;
    private volatile long lastMeasurementNs = -1;
    private volatile long lastUiMs = 0;
    private int cameraTexture;
    private int shaderProgram;
    private int positionAttrib;
    private int texAttrib;
    private int samplerUniform;
    private final FloatBuffer vertices = directFloats(new float[]{-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f});
    private final FloatBuffer textureCoords = directFloats(new float[8]);

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        glView = new GLSurfaceView(this);
        glView.setEGLContextClientVersion(2);
        glView.setRenderer(this);
        glView.setRenderMode(GLSurfaceView.RENDERMODE_CONTINUOUSLY);
        root.addView(glView, new FrameLayout.LayoutParams(-1,-1));

        TextView crosshair = new TextView(this);
        crosshair.setText("＋");
        crosshair.setTextSize(54);
        crosshair.setTextColor(Color.WHITE);
        crosshair.setGravity(Gravity.CENTER);
        crosshair.setContentDescription("المؤشر الأوسط لموضع قراءة العمق");
        FrameLayout.LayoutParams crosshairLayout = new FrameLayout.LayoutParams(110,110,Gravity.CENTER);
        root.addView(crosshair,crosshairLayout);

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(20,20,20,20);
        panel.setBackgroundColor(0xDF101010);
        FrameLayout.LayoutParams panelParams = new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM);
        status = new TextView(this);
        status.setTextColor(Color.WHITE);
        status.setTextSize(18);
        status.setText("للتجارب الثابتة فقط. تحقق من دعم ARCore Depth؛ لا تمشِ أثناء التصوير.");
        reading = new TextView(this);
        reading.setTextColor(0xFFFFD43B);
        reading.setTextSize(32);
        reading.setText("— متر");
        reading.setContentDescription("لا تتوفر قياسات بعد");
        Button speak = new Button(this);
        speak.setText("انطق القياس الحالي");
        speak.setContentDescription("قراءة مسافة السطح الأوسط بالأمتار");
        speak.setOnClickListener(view -> {
            double meters=lastMeters;
            long age=System.nanoTime()-lastMeasurementNs;
            if(Double.isFinite(meters) && lastMeasurementNs>0 && age >= 0 && age < 1_500_000_000L) {
                speak("مسافة السطح في منتصف الكاميرا تقريبا " + String.format(Locale.US,"%.2f",meters) + " متر. قياس تجريبي.");
            } else {
                speak("لا توجد قراءة عمق حديثة موثوقة. لا تعتمد على هذا القياس أثناء المشي.");
            }
        });
        panel.addView(status);
        panel.addView(reading);
        panel.addView(speak);
        root.addView(panel,panelParams);
        setContentView(root);
        tts=new TextToSpeech(this, s -> {
            if(s==TextToSpeech.SUCCESS)tts.setLanguage(new Locale("ar","SA"));
        });
    }

    private void speak(String text) {
        if(tts!=null)tts.speak(text,TextToSpeech.QUEUE_FLUSH,null,"basira-arcore");
    }

    private void showStatus(String message) {
        runOnUiThread(()-> status.setText(message));
    }

    @Override public void onResume() {
        super.onResume();
        if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA},CAMERA_REQUEST);
            return;
        }
        try {
            if(session==null) {
                ArCoreApk.InstallStatus install=ArCoreApk.getInstance().requestInstall(this,!installRequested);
                if(install==ArCoreApk.InstallStatus.INSTALL_REQUESTED) {
                    installRequested=true;
                    showStatus("ثبّت أو حدّث خدمات Google Play للواقع المعزز ثم عد للتطبيق.");
                    return;
                }
                session=new Session(this);
                if(!session.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) {
                    session.close();session=null;
                    showStatus("هذا الهاتف لا يدعم ARCore Depth. لن نعرض أمتارًا تخمينية.");
                    return;
                }
                Config config=session.getConfig();
                config.setDepthMode(Config.DepthMode.AUTOMATIC);
                session.configure(config);
                configured=true;
            }
            session.resume();
            glView.onResume();
        } catch(Exception error) {
            configured=false;
            lastMeters=Double.NaN;
            showStatus("تعذر تشغيل ARCore Depth. تحقق من دعم الجهاز وإذن الكاميرا.");
        }
    }

    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grants) {
        super.onRequestPermissionsResult(requestCode,permissions,grants);
        if(requestCode==CAMERA_REQUEST) {
            if(grants.length>0 && grants[0]==PackageManager.PERMISSION_GRANTED) onResume();
            else showStatus("رُفض إذن الكاميرا. لا يمكن قياس المسافات.");
        }
    }

    @Override public void onPause() {
        glView.onPause();
        if(session!=null)session.pause();
        lastMeters=Double.NaN;
        lastMeasurementNs=-1;
        super.onPause();
    }

    @Override public void onDestroy() {
        configured=false;
        if(session!=null){session.close();session=null;}
        if(tts!=null){tts.stop();tts.shutdown();}
        super.onDestroy();
    }

    @Override public void onSurfaceCreated(GL10 gl,EGLConfig config) {
        int[] textures=new int[1];
        GLES20.glGenTextures(1,textures,0);
        cameraTexture=textures[0];
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,cameraTexture);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_MIN_FILTER,GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_MAG_FILTER,GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_WRAP_S,GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_WRAP_T,GLES20.GL_CLAMP_TO_EDGE);
        int vertex=compileShader(GLES20.GL_VERTEX_SHADER,
                "attribute vec2 position; attribute vec2 uv; varying vec2 passUv; void main(){gl_Position=vec4(position,0.0,1.0); passUv=uv;}");
        int fragment=compileShader(GLES20.GL_FRAGMENT_SHADER,
                "#extension GL_OES_EGL_image_external : require\nprecision mediump float; uniform samplerExternalOES camera; varying vec2 passUv; void main(){gl_FragColor=texture2D(camera,passUv);}");
        shaderProgram=GLES20.glCreateProgram();
        GLES20.glAttachShader(shaderProgram,vertex);
        GLES20.glAttachShader(shaderProgram,fragment);
        GLES20.glLinkProgram(shaderProgram);
        positionAttrib=GLES20.glGetAttribLocation(shaderProgram,"position");
        texAttrib=GLES20.glGetAttribLocation(shaderProgram,"uv");
        samplerUniform=GLES20.glGetUniformLocation(shaderProgram,"camera");
        GLES20.glDeleteShader(vertex);
        GLES20.glDeleteShader(fragment);
    }

    private static int compileShader(int type,String source) {
        int shader=GLES20.glCreateShader(type);
        GLES20.glShaderSource(shader,source);
        GLES20.glCompileShader(shader);
        return shader;
    }

    @Override public void onSurfaceChanged(GL10 gl,int width,int height) {
        GLES20.glViewport(0,0,width,height);
    }

    @Override public void onDrawFrame(GL10 gl) {
        GLES20.glClearColor(0,0,0,1);
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);
        Session active=session;
        if(!configured||active==null||cameraTexture==0)return;
        try {
            active.setCameraTextureName(cameraTexture);
            active.setDisplayGeometry(getWindowManager().getDefaultDisplay().getRotation(),
                Math.max(1,glView.getWidth()),Math.max(1,glView.getHeight()));
            Frame frame=active.update();
            vertices.position(0);
            textureCoords.position(0);
            frame.transformCoordinates2d(Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES,
                vertices,Coordinates2d.TEXTURE_NORMALIZED,textureCoords);
            drawCamera();
            Camera camera=frame.getCamera();
            if(camera.getTrackingState()!=TrackingState.TRACKING) {
                markUnavailable("انتظر استقرار تتبع ARCore. لا توجد قراءة حالية.");
                return;
            }
            try(Image depth=frame.acquireDepthImage16Bits()) {
                Double value=stableCentreMeters(depth);
                if(value!=null) {
                    lastMeters=value;
                    lastMeasurementNs=System.nanoTime();
                    long now=SystemClock.elapsedRealtime();
                    if(now-lastUiMs>600) {
                        lastUiMs=now;
                        final String label=String.format(Locale.US,"%.2f متر",value);
                        runOnUiThread(()->{
                            reading.setText(label);
                            reading.setContentDescription("قراءة بحثية لمسافة السطح: "+label);
                            status.setText("عمق ARCore حقيقي بالمتر من السطح الأوسط، وليس مسافة آمنة للمشي.");
                        });
                    }
                } else markUnavailable("السطح لا يملك عمقًا متماسكًا؛ لم تُعرض أمتار.");
            } catch(NotYetAvailableException e) {
                markUnavailable("بيانات العمق لم تجهز؛ حرّك الهاتف قليلًا ثم ثبّته بأمان.");
            }
        }catch(Exception e){
            markUnavailable("تعذر قراءة إطار ARCore؛ تحقق من التتبع والكاميرا.");
        }
    }

    private void drawCamera() {
        GLES20.glUseProgram(shaderProgram);
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,cameraTexture);
        GLES20.glUniform1i(samplerUniform,0);
        vertices.position(0);
        GLES20.glEnableVertexAttribArray(positionAttrib);
        GLES20.glVertexAttribPointer(positionAttrib,2,GLES20.GL_FLOAT,false,0,vertices);
        textureCoords.position(0);
        GLES20.glEnableVertexAttribArray(texAttrib);
        GLES20.glVertexAttribPointer(texAttrib,2,GLES20.GL_FLOAT,false,0,textureCoords);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP,0,4);
        GLES20.glDisableVertexAttribArray(positionAttrib);
        GLES20.glDisableVertexAttribArray(texAttrib);
    }

    private void markUnavailable(String message) {
        lastMeters=Double.NaN;
        lastMeasurementNs=-1;
        long now=SystemClock.elapsedRealtime();
        if(now-lastUiMs<700)return;
        lastUiMs=now;
        runOnUiThread(()->{
            reading.setText("— متر");
            reading.setContentDescription("لا توجد قياسات صالحة");
            status.setText(message);
        });
    }

    /**
     * A conservative 9x9 depth-centre region. Pixel values encode millimetres,
     * invalid pixels are zero, and background mixture triggers rejection.
     * This is camera-to-surface depth, not the distance to a detected object.
     */
    private static Double stableCentreMeters(Image image) {
        if(image.getPlanes().length!=1)return null;
        Image.Plane plane=image.getPlanes()[0];
        ByteBuffer buffer=plane.getBuffer().duplicate().order(ByteOrder.LITTLE_ENDIAN);
        int w=image.getWidth(),h=image.getHeight();
        if(w<32||h<24)return null;
        double[] samples=new double[81];
        int n=0;
        for(int y=-4;y<=4;y++)for(int x=-4;x<=4;x++){
            int px=w/2+x,py=h/2+y;
            int index=py*plane.getRowStride()+px*plane.getPixelStride();
            if(index<0 || index+1>=buffer.limit())continue;
            int mm=Short.toUnsignedInt(buffer.getShort(index));
            if(mm>=500&&mm<=5000)samples[n++]=mm/1000.0;
        }
        if(n<66)return null;
        Arrays.sort(samples,0,n);
        double mid=samples[n/2];
        double spread=samples[(int)Math.floor((n-1)*.9)]-samples[(int)Math.floor((n-1)*.1)];
        if(spread>Math.max(.15,.12*mid))return null;
        return Math.round(mid*100.0)/100.0;
    }

    private static FloatBuffer directFloats(float[] data) {
        ByteBuffer bytes=ByteBuffer.allocateDirect(data.length*4).order(ByteOrder.nativeOrder());
        FloatBuffer result=bytes.asFloatBuffer();
        result.put(data);
        result.position(0);
        return result;
    }
}
