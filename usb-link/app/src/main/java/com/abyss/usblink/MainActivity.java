package com.abyss.usblink;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Two Android phones, one APK. Redmi = OTG/USB host. POCO = accessory/capture.
 * Never uses Internet tethering, network discovery, shell/root or hidden APIs.
 * The only network socket is an optional H264 UDP loopback on the Redmi.
 */
public final class MainActivity extends Activity {
    private static final String USB_PERMISSION = "com.abyss.usblink.USB_PERMISSION";
    private static final int SCREEN_REQUEST = 201;
    private static final int AOA_VENDOR_ID = 0x18d1;
    private static final int[] AOA_PRODUCT_IDS = {0x2d00, 0x2d01, 0x2d04, 0x2d05};
    private final Handler handler = new Handler(Looper.getMainLooper());
    private UsbManager usb;
    private TextView status;
    private boolean registered;
    private int captureFps = 60;
    private int captureBitrate = 6000000;

    private final BroadcastReceiver usbEvents = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (USB_PERMISSION.equals(action)) {
                boolean allowed = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                if (!allowed) { message("Permissão USB negada. Toque em Receber novamente."); return; }
                // Permission may be for the host-mode Redmi or for accessory-mode POCO.
                if (intent.hasExtra(UsbManager.EXTRA_DEVICE)) connectRedmi();
                else message("Permissão do cabo concedida. Toque em Transmitir no POCO.");
            } else if (UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(action)) {
                handler.postDelayed(() -> connectRedmi(), 700);
            } else if (UsbManager.ACTION_USB_ACCESSORY_DETACHED.equals(action)) {
                message("Cabo desconectado no POCO. A transmissão precisa ser reiniciada.");
                stopService(new Intent(MainActivity.this, CaptureService.class));
            } else if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(action)) {
                message("USB removido. Reabra o receptor após reconectar.");
                stopService(new Intent(MainActivity.this, UsbReceiveService.class));
            }
        }
    };

    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        usb = (UsbManager) getSystemService(USB_SERVICE);
        ScrollView scroller = new ScrollView(this);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(34, 38, 34, 38);
        col.setBackgroundColor(0xff101826);
        scroller.addView(col);

        TextView title = new TextView(this);
        title.setText("Abyss USB Link 0.1");
        title.setTextColor(0xff8bcdf4);
        title.setTextSize(26);
        title.setPadding(0, 0, 0, 18);
        col.addView(title);

        status = new TextView(this);
        status.setTextColor(0xffe2eef6);
        status.setTextSize(16);
        status.setPadding(0, 0, 0, 28);
        col.addView(status);

        addButton(col, "1. REDMI: preparar receptor pelo OTG", () -> connectRedmi());
        addButton(col, "2. POCO: transmitir tela pelo cabo", () -> askScreen());
        addButton(col, "POCO: alternar 720p 30/60 FPS", () -> {
            captureFps = captureFps == 60 ? 30 : 60;
            captureBitrate = captureFps == 60 ? 6000000 : 3500000;
            message("Próxima captura: 720p " + captureFps + " fps alvo, " +
                    (captureBitrate / 1000000.0) + " Mbps.");
        });
        addButton(col, "Parar transmissão / receptor", () -> {
            stopService(new Intent(this, CaptureService.class));
            stopService(new Intent(this, UsbReceiveService.class));
            message("Parada solicitada.");
        });
        TextView help = new TextView(this);
        help.setTextColor(0xffb9c9d5);
        help.setTextSize(14);
        help.setPadding(0, 26, 0, 14);
        help.setText("REDMI: conecte o hub OTG e o cabo do POCO. Ative o receptor primeiro.\n\n" +
                "POCO: aceite acesso USB, depois autorize a captura de tela.\n\n" +
                "No Abyss Stream do Redmi, adicione a fonte de mídia/FFmpeg: " +
                "udp://127.0.0.1:12345?fifo_size=500000&overrun_nonfatal=1\n" +
                "Formato forçado: h264. Buffer: 0 MB.\n\n" +
                "Não usa Wi-Fi, HDMI ou ancoragem USB. Precisa de USB Host no Redmi " +
                "e USB Accessory no POCO. Áudio ainda não transmitido.");
        col.addView(help);
        setContentView(scroller);

        IntentFilter f = new IntentFilter();
        f.addAction(USB_PERMISSION);
        f.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        f.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        f.addAction(UsbManager.ACTION_USB_ACCESSORY_DETACHED);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(usbEvents, f, Context.RECEIVER_EXPORTED);
        else registerReceiver(usbEvents, f);
        registered = true;
        boolean host = getPackageManager().hasSystemFeature(PackageManager.FEATURE_USB_HOST);
        boolean accessory = getPackageManager().hasSystemFeature(PackageManager.FEATURE_USB_ACCESSORY);
        message("USB Host: " + host + " | USB Accessory: " + accessory +
                "\nConecte o cabo de dados. No Redmi, clique em preparar receptor.");
    }
    @Override protected void onDestroy() {
        if (registered) { unregisterReceiver(usbEvents); registered = false; }
        super.onDestroy();
    }
    private void addButton(LinearLayout col, String label, Runnable click) {
        Button b = new Button(this);
        b.setAllCaps(false);
        b.setText(label);
        b.setTextSize(16);
        b.setTextColor(0xfff5f9fd);
        b.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xff294c68));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.bottomMargin = 15;
        col.addView(b, lp);
        b.setOnClickListener(v -> click.run());
    }
    private void message(String s) { if (status != null) status.setText(s); }

    /** Initial AOA handshake on the Redmi, or start receiver on reenumerated device. */
    private void connectRedmi() {
        Map<String, UsbDevice> found = usb.getDeviceList();
        if (found.isEmpty()) {
            message("O Redmi não detectou outro celular por USB. Verifique se o hub OTG " +
                    "está no Redmi e se o cabo transmite dados.");
            return;
        }
        UsbDevice original = null;
        for (UsbDevice d : found.values()) {
            if (isAccessoryDevice(d)) {
                if (!usb.hasPermission(d)) {
                    message("Autorize o USB no Redmi para receber vídeo.");
                    usb.requestPermission(d, usbPendingIntent());
                    return;
                }
                Intent i = new Intent(this, UsbReceiveService.class);
                i.putExtra("device_name", d.getDeviceName());
                startForegroundService(i);
                message("Receptor ativo. Inicie a captura no POCO.\n" +
                        "No Abyss Stream, use UDP local 127.0.0.1:12345, formato h264.");
                return;
            }
            if (original == null) original = d;
        }
        if (original == null) { message("Dispositivo USB não encontrado."); return; }
        if (!usb.hasPermission(original)) {
            message("Autorize o Redmi a acessar o POCO pelo cabo.");
            usb.requestPermission(original, usbPendingIntent());
            return;
        }
        UsbDevice candidate = original;
        message("Testando Android Open Accessory no POCO...");
        new Thread(() -> {
            String result = tryEnterAccessoryMode(candidate);
            handler.post(() -> {
                message(result);
                if (result.startsWith("AOA iniciado")) handler.postDelayed(this::connectRedmi, 1800);
            });
        }, "abyss-aoa-handshake").start();
    }
    private PendingIntent usbPendingIntent() {
        Intent i = new Intent(USB_PERMISSION).setPackage(getPackageName());
        return PendingIntent.getBroadcast(this, 0, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
    }
    private static boolean isAccessoryDevice(UsbDevice d) {
        if (d.getVendorId() != AOA_VENDOR_ID) return false;
        for (int id : AOA_PRODUCT_IDS) if (d.getProductId() == id) return true;
        return false;
    }
    private String tryEnterAccessoryMode(UsbDevice d) {
        android.hardware.usb.UsbDeviceConnection conn = usb.openDevice(d);
        if (conn == null) return "Não consegui abrir o USB. Verifique a autorização.";
        try {
            byte[] protocol = new byte[2];
            int n = conn.controlTransfer(0xC0, 51, 0, 0, protocol, 2, 1500);
            if (n != 2) return "POCO não respondeu ao protocolo AOA (51). " +
                    "Pode não ser compatível, ou o cabo/hub não tem dados.";
            int version = (protocol[0] & 255) | ((protocol[1] & 255) << 8);
            if (version < 1) return "Versão AOA não compatível: " + version;
            String[] ids = {"Abyss", "USB Screen Link", "USB low-latency screen relay",
                    "1", "https://example.org/abyss-usb-link", "abyss-link-1"};
            for (int ix = 0; ix < ids.length; ix++) {
                byte[] bytes = (ids[ix] + "\0").getBytes(StandardCharsets.UTF_8);
                int sent = conn.controlTransfer(0x40, 52, 0, ix, bytes, bytes.length, 1500);
                if (sent != bytes.length) return "Falha na identificação AOA: campo " + ix;
            }
            int ok = conn.controlTransfer(0x40, 53, 0, 0, null, 0, 1500);
            if (ok < 0) return "POCO rejeitou a mudança para USB Accessory.";
            return "AOA iniciado (versão " + version + "). Aguardando o POCO reconectar...";
        } finally { conn.close(); }
    }
    private void askScreen() {
        android.hardware.usb.UsbAccessory[] accessories = usb.getAccessoryList();
        if (accessories == null || accessories.length == 0) {
            message("POCO ainda não entrou no modo USB Accessory. " +
                    "Primeiro clique em preparar receptor no Redmi.");
            return;
        }
        if (!usb.hasPermission(accessories[0])) {
            usb.requestPermission(accessories[0], usbPendingIntent());
            message("Autorize o acessório USB no POCO e toque em Transmitir novamente.");
            return;
        }
        MediaProjectionManager manager =
                (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        startActivityForResult(manager.createScreenCaptureIntent(), SCREEN_REQUEST);
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != SCREEN_REQUEST) return;
        if (result != RESULT_OK || data == null) {
            message("Captura não autorizada. Nada será gravado ou transmitido.");
            return;
        }
        Intent start = new Intent(this, CaptureService.class);
        start.putExtra("result", result);
        start.putExtra("data", data);
        start.putExtra("fps", captureFps);
        start.putExtra("bitrate", captureBitrate);
        startForegroundService(start);
        message("Enviando tela por USB. Mantenha o serviço ativo no POCO.");
    }
}
