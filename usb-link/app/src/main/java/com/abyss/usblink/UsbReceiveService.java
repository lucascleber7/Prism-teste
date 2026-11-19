package com.abyss.usblink;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.IBinder;
import android.util.Log;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Android USB Host -> H264 elementary stream on local UDP.
 * All network traffic is 127.0.0.1; Internet and USB tethering are not used.
 * The existing Abyss Stream FFmpeg source is the consumer.
 */
public final class UsbReceiveService extends Service {
    private static final String TAG = "AbyssUSB-Receiver";
    private static final String CHANNEL = "abyss_usb_receive";
    private final AtomicBoolean running = new AtomicBoolean();
    private volatile UsbDeviceConnection connection;
    private Thread worker;

    @Override public void onCreate() {
        super.onCreate();
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Abyss USB receptor",
                NotificationManager.IMPORTANCE_LOW));
    }
    private Notification note(String text) {
        return new Notification.Builder(this, CHANNEL)
                .setContentTitle("Abyss USB Link: Redmi recebendo")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.presence_video_online)
                .setOngoing(true).build();
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        startForeground(31, note("Aguardando vídeo H.264 pelo cabo OTG"),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        if (running.getAndSet(true)) return START_NOT_STICKY;
        worker = new Thread(this::receiveLoop, "abyss-usb-receiver");
        worker.start();
        return START_NOT_STICKY;
    }

    private void receiveLoop() {
        DatagramSocket udp = null;
        UsbDeviceConnection conn = null;
        try {
            UsbManager usb = (UsbManager)getSystemService(USB_SERVICE);
            UsbDevice target = null;
            for (UsbDevice d : usb.getDeviceList().values()) {
                if (d.getVendorId() == 0x18d1 &&
                        (d.getProductId() == 0x2d00 || d.getProductId() == 0x2d01 ||
                         d.getProductId() == 0x2d04 || d.getProductId() == 0x2d05)) {
                    target = d; break;
                }
            }
            if (target == null || !usb.hasPermission(target))
                throw new IllegalStateException("POCO não está autorizado em modo AOA");
            UsbInterface chosen = null;
            UsbEndpoint incoming = null;
            for (int i = 0; i < target.getInterfaceCount() && incoming == null; i++) {
                UsbInterface iface = target.getInterface(i);
                for (int e = 0; e < iface.getEndpointCount(); e++) {
                    UsbEndpoint ep = iface.getEndpoint(e);
                    if (ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK &&
                            ep.getDirection() == UsbConstants.USB_DIR_IN) {
                        chosen = iface; incoming = ep; break;
                    }
                }
            }
            if (incoming == null) throw new IllegalStateException("USB bulk IN não encontrado");
            conn = usb.openDevice(target);
            if (conn == null || !conn.claimInterface(chosen, true))
                throw new IllegalStateException("Falha ao assumir interface USB");
            connection = conn;
            udp = new DatagramSocket();
            InetAddress loopback = InetAddress.getByName("127.0.0.1");
            byte[] usbPacket = new byte[16384];
            DatagramPacket datagram = new DatagramPacket(usbPacket, 0, loopback, 12345);
            long total = 0, lastLog = android.os.SystemClock.elapsedRealtime();
            while (running.get()) {
                int size = conn.bulkTransfer(incoming, usbPacket, usbPacket.length, 500);
                if (size <= 0) continue;
                // Preserve encoded H264 bytes in order; small datagrams avoid IP fragmentation.
                // Endpoints and UDP transport do not preserve AVC access-unit boundaries.
                for (int off = 0; off < size; off += 1200) {
                    int n = Math.min(1200, size - off);
                    datagram.setData(usbPacket, off, n);
                    udp.send(datagram);
                }
                total += size;
                long now = android.os.SystemClock.elapsedRealtime();
                if (now - lastLog >= 3000) {
                    final long mb = total / 1024;
                    Log.i(TAG, "USB received total KiB=" + mb);
                    lastLog = now;
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "USB receiver failed", e);
        } finally {
            running.set(false);
            if (udp != null) udp.close();
            if (conn != null) {
                try { conn.close(); } catch (Exception ignored) {}
            }
            connection = null;
            stopSelf();
        }
    }
    @Override public void onDestroy() {
        running.set(false);
        UsbDeviceConnection c = connection;
        if (c != null) c.close();
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
