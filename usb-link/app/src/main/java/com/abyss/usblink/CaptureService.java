package com.abyss.usblink;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.content.res.Resources;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.hardware.usb.UsbAccessory;
import android.hardware.usb.UsbManager;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Surface;
import android.view.WindowManager;

import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.util.concurrent.atomic.AtomicBoolean;

/** POCO: user-consented MediaProjection -> surface-input MediaCodec AVC -> USB AOA bulk. */
public final class CaptureService extends Service {
    private static final String TAG = "AbyssUSB-Sender";
    private static final String CHANNEL = "abyss_usb_capture";
    private final AtomicBoolean running = new AtomicBoolean();
    private Thread worker;
    private volatile ParcelFileDescriptor fd;

    @Override public void onCreate() {
        super.onCreate();
        NotificationManager nm = (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Abyss USB transmissão",
                NotificationManager.IMPORTANCE_LOW));
    }
    private Notification note(String text) {
        return new Notification.Builder(this, CHANNEL)
                .setContentTitle("Abyss USB Link: POCO transmitindo")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.presence_video_online)
                .setOngoing(true).build();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || !intent.hasExtra("data")) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (running.getAndSet(true)) return START_NOT_STICKY;
        startForeground(32, note("Captura por cabo USB autorizada"),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        int consent = intent.getIntExtra("result", 0);
        Intent token = intent.getParcelableExtra("data");
        int fps = Math.max(15, Math.min(60, intent.getIntExtra("fps", 60)));
        int bitrate = Math.max(1500000, Math.min(10000000,
                intent.getIntExtra("bitrate", 6000000)));
        worker = new Thread(() -> stream(consent, token, fps, bitrate),
                "abyss-usb-encoder");
        worker.start();
        return START_NOT_STICKY;
    }

    private static byte[] copy(ByteBuffer b) {
        ByteBuffer x = b.duplicate();
        byte[] bytes = new byte[x.remaining()];
        x.get(bytes);
        return bytes;
    }
    private void stream(int consent, Intent token, int fps, int bitrate) {
        MediaProjection projection = null;
        MediaCodec encoder = null;
        VirtualDisplay display = null;
        Surface surface = null;
        FileOutputStream out = null;
        try {
            UsbManager usb = (UsbManager)getSystemService(USB_SERVICE);
            UsbAccessory[] list = usb.getAccessoryList();
            if (list == null || list.length == 0 || !usb.hasPermission(list[0]))
                throw new IllegalStateException("Sem USB Accessory autorizado no POCO");
            fd = usb.openAccessory(list[0]);
            if (fd == null) throw new IllegalStateException("Não abriu o acessório USB");
            out = new FileOutputStream(fd.getFileDescriptor());

            MediaProjectionManager pm = (MediaProjectionManager)
                    getSystemService(MEDIA_PROJECTION_SERVICE);
            projection = pm.getMediaProjection(consent, token);
            if (projection == null) throw new IllegalStateException("Permissão de captura inválida");
            projection.registerCallback(new MediaProjection.Callback() {
                @Override public void onStop() {
                    running.set(false);
                    stopSelf();
                }
            }, new Handler(Looper.getMainLooper()));

            DisplayMetrics metrics = new DisplayMetrics();
            WindowManager wm = (WindowManager)getSystemService(WINDOW_SERVICE);
            wm.getDefaultDisplay().getRealMetrics(metrics);
            // 720p short side, preserve aspect ratio and codec macroblock alignment.
            float factor = 720f / Math.max(1, Math.min(metrics.widthPixels, metrics.heightPixels));
            int width = Math.max(320, Math.round(metrics.widthPixels * factor / 16) * 16);
            int height = Math.max(320, Math.round(metrics.heightPixels * factor / 16) * 16);
            int density = metrics.densityDpi;

            MediaFormat f = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC,
                    width, height);
            f.setInteger(MediaFormat.KEY_COLOR_FORMAT,
                    MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
            f.setInteger(MediaFormat.KEY_BIT_RATE, bitrate);
            f.setInteger(MediaFormat.KEY_FRAME_RATE, fps);
            f.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1);
            encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC);
            Log.i(TAG, "Encoder=" + encoder.getName() + " w=" + width +
                    " h=" + height + " fps_target=" + fps + " bitrate=" + bitrate);
            encoder.configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            surface = encoder.createInputSurface();
            encoder.start();

            display = projection.createVirtualDisplay("Abyss USB screen capture",
                    width, height, density, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    surface, null, new Handler(Looper.getMainLooper()));
            if (display == null) throw new IllegalStateException("VirtualDisplay indisponível");
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            byte[] csd0 = null, csd1 = null;
            int zeroCount = 0;
            while (running.get()) {
                int idx = encoder.dequeueOutputBuffer(info, 10000);
                if (idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat outputFormat = encoder.getOutputFormat();
                    ByteBuffer c0 = outputFormat.getByteBuffer("csd-0");
                    ByteBuffer c1 = outputFormat.getByteBuffer("csd-1");
                    if (c0 != null) csd0 = copy(c0);
                    if (c1 != null) csd1 = copy(c1);
                    continue;
                }
                if (idx == MediaCodec.INFO_TRY_AGAIN_LATER) continue;
                if (idx < 0) continue;
                try {
                    if (info.size <= 0) continue;
                    ByteBuffer buffer = encoder.getOutputBuffer(idx);
                    if (buffer == null) continue;
                    buffer.position(info.offset);
                    buffer.limit(info.offset + info.size);
                    byte[] encoded = new byte[info.size];
                    buffer.get(encoded);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
                        // Preserve the exact hardware codec config stream.
                        out.write(encoded);
                        continue;
                    }
                    if ((info.flags & MediaCodec.BUFFER_FLAG_KEY_FRAME) != 0) {
                        // New OBS listeners need recent SPS/PPS to decode at any time.
                        if (csd0 != null) out.write(csd0);
                        if (csd1 != null) out.write(csd1);
                    }
                    out.write(encoded);
                } finally {
                    encoder.releaseOutputBuffer(idx, false);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "USB capture/encoder failed", e);
        } finally {
            running.set(false);
            if (display != null) display.release();
            if (encoder != null) {
                try { encoder.stop(); } catch (Exception ignored) {}
                encoder.release();
            }
            if (surface != null) surface.release();
            if (projection != null) {
                try { projection.stop(); } catch (Exception ignored) {}
            }
            if (out != null) try { out.close(); } catch (Exception ignored) {}
            ParcelFileDescriptor current = fd;
            if (current != null) try { current.close(); } catch (Exception ignored) {}
            fd = null;
            stopSelf();
        }
    }
    @Override public void onDestroy() {
        running.set(false);
        ParcelFileDescriptor current = fd;
        if (current != null) try { current.close(); } catch (Exception ignored) {}
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
