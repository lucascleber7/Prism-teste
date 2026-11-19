# Abyss USB Link · teste técnico 0.1

Um aplicativo Android separado, com **dois modos**:
- **POCO X7 Pro: transmitir** (MediaProjection consentido + MediaCodec H.264 de entrada Surface; USB Accessory)
- **Redmi: receber** (USB Host OTG, negociação Android Open Accessory 1.0, recepção USB Bulk, saída local UDP 127.0.0.1:12345)

### Conexão
Redmi com hub OTG (porta USB-A) **→ cabo de dados USB-A/USB-C → POCO USB-C**. O Redmi deve reconhecer um dispositivo USB pelo Android UsbManager. Instale o mesmo APK nos dois telefones. Em ambos, ative as permissões USB quando o Android pedir.

1. No Redmi, abra Abyss USB Link e toque **REDMI: preparar receptor pelo OTG**. Ele consulta o dispositivo USB, pede permissão e envia negociações AOA (51/52/53).
2. O POCO deve entrar no modo USB Accessory e autorizar o aplicativo Abyss USB Link; no POCO toque **POCO: transmitir tela pelo cabo**, aceite a permissão do Android para MediaProjection.
3. No Redmi, o serviço USB envia os bytes H264 para **somente a rede local interna** `udp://127.0.0.1:12345` (não usa Wi-Fi, rede móvel, ancoragem ou servidor externo).
4. Abra o **Abyss Stream** no Redmi, fonte de mídia/FFmpeg -> entrada `udp://127.0.0.1:12345?fifo_size=500000&overrun_nonfatal=1` -> formato forçado `h264` -> buffer 0 MB. Inicie o receptor antes do transmissor; se necessário, reinicie a transmissão para obter SPS/PPS no novo receptor.

### Limitações e segurança
- **Prova de conceito sem testes físicos de dois aparelhos**. O Android USB Host e USB Accessory são recursos opcionais em hardwares diferentes; se AOA não funcionar, cabo e hub sozinhos não resolvem.
- Controle de captura **exige autorização explícita no POCO**. O serviço mostra notificação e pode ser interrompido. Não usa root, ADB nem permissões ocultas.
- A taxa de quadros de 60fps é **meta**, não garantia; depende do encoder, conexão USB, decoder e renderização do Redmi. No primeiro teste, experimente 720p30 se 720p60 travar.
- Sem áudio nesta versão; ainda não há tratamento completo de rotação durante captura.
- O preview nativo não foi incorporado diretamente ao OBS: o recebedor injeta H264 no FFmpeg via **UDP de loopback**. O receptor usa Internet permission somente para socket local, sem tráfego externo.
- AOA exige USB real; no modo Redmi a tela do app pode ir ao fundo enquanto o serviço de recepção opera.
- O aplicativo é **experimental** e o APK `debug` é assinado com chave de desenvolvimento, não distribuí-lo como release de produção.
- O projeto não contém o código original do TikTok LIVE Studio nem copia as marcas de outras empresas.
- **Ainda falta:** validar API/codec no POCO e o chip do Redmi, auditar a compatibilidade com o OBS FFmpeg, adicionar áudio e testes prolongados.

### Correções/QA futuros
- Amostrar RTT entre H264 enviado/recebido e decodificado, watchdog, métricas de fila, reconexão USB e latência térmica.
- Empacotar H264 em MPEG-TS/RTP com timestamps e tratamento de perda, evitando depender da tolerância do demuxer raw H264 a segmentos UDP.
- Verificar desempenho do Redmi com MediaCodec, integração ao plugin OBS em vez de sockets locais, tolerância à rotação e áudio AAC/Opus.
- Testar hub e cabo reais; nenhum APK corrige um Redmi sem OTG Host ou POCO sem AOA.

Referência oficial AOA: https://source.android.com/docs/core/interaction/accessories/aoa
