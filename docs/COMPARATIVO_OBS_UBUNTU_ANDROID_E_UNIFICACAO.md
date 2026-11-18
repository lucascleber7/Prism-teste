# OBS POCO PRO — comparativo e plano de unificação

Data da auditoria: 18/11/2026.

## Projetos comparados
- **Nosso OBS legado**: OBS Studio 32.2.2 executado em Ubuntu PRoot + Termux:X11 no POCO X7 Pro, com perfis, scripts de diagnóstico, PulseAudio, pontes de captura, cenas, overlays e personalização.
- **Base Android adaptada**: fork do OBS for Android (OBS Studio 33) com o código personalizado do OBS POCO PRO. Fonte nativa: MediaProjection, Camera2, UVC, AAudio, MediaCodec, navegador Android, RTMP, FFmpeg. Integrações em commits de 2d42a9d a 656dc7e na árvore de desenvolvimento.
- **Situação de instalação verificada em 18/11**: POCO tinha 0.3.1-poco instalada (versionCode 28); a revisão 0.3.2-poco (versionCode 29) foi compilada, mas não foi validada em live real.

## Inventário verificado do Ubuntu
- 18 perfis e 9 coleções de cenas em `obs-poco-gpu-bench`.
- Cenas incluem fontes `browser_source` OWN3D, `text_ft2_source` chamada `FPS AO VIVO - TESTE`, áudio PulseAudio, vídeos FFmpeg, captura XSHM.
- Perfis de teste incluem 1080 × 1920/60 FPS/10.000 kbps/x264 ultrafast e 720 × 1280/30 FPS/4.000 kbps.
- Scripts de diagnóstico e métricas existem, mas nenhum perfil prova estabilidade sustentada. No Termux:X11 havia perdas de FPS e gargalos de CPU/llvmpipe.
- A fonte de texto FPS não é um medidor persistente global do jogo.
- Nenhuma integração TikFinity foi identificada nas coleções examinadas.

## Comparação de recursos
| Categoria | Legado Ubuntu | Base Android personalizada | Ação para unificação |
|---|---|---|---|
| Interface | OBS desktop, muitos menus e cenas | Qt Android adaptado; menus de toque ainda problemáticos | Simplificar telas e oferecer acesso rápido às funções |
| FPS | Logs/scripts e texto em cena | FPS renderizado e contadores no log a cada 10 s | Overlay flutuante com permissão Android; diferenciar FPS OBS e FPS de jogos |
| Captura da tela | FFmpeg/MediaProjection externo, XSHM | MediaProjection/GPU nativos | Validar captura real, 1080p60 e estabilidade fora de foco |
| Codificador | x264 CPU, muitos perfis | MediaCodec H.264/H.265, superfície GPU, CBR e bitrate adaptativo | Testes por chipset; limites reais de cada encoder |
| Câmera | Fonte desktop e cenas | Camera2 interna e UVC USB presentes | Fluxo de permissão, fonte e janela de prévia mais simples |
| Áudio | PulseAudio e múltiplos dispositivos | Microfone Android AAudio, algumas limitações | Roteamento do áudio da tela remota e das páginas de navegador |
| Alertas OWN3D | URLs presentes em cenas antigas | Fonte navegador Android | Assistente de importação de URL; testar áudio e transparência |
| TikFinity | Não encontrado nas cenas examinadas | Pode receber overlay por URL, mas não possui integração pronta | Assistente de overlay TikFinity; integração de eventos só por APIs autorizadas |
| Transmissão | RTMP e perfis antigos | RTMP nativo e reconexão | Confirmar plataforma/stream key e adaptação sob rede instável |
| Dois dispositivos | scrcpy e pontes externas | Fonte FFmpeg UDP/RTMP/USB-rede, UVC | Descoberta LAN, vídeo/áudio, reconexão e testes USB físicos |
| Plugins | Plugins Linux da instalação desktop | 16 módulos embarcados e importação ARM64 experimental | Priorizar plugins suportados e validar assinaturas/ABI |
| Eficiência | Termux:X11, PRoot, x264/llvmpipe | Acesso nativo ao Android, GPU e MediaCodec | Evitar reintroduzir emulação e CPU desnecessários |
| Dispositivos | Scripts/configurações fixas do POCO | Consulta MediaCodecInfo de capacidades reais | Adaptar Qualcomm/MediaTek/Exynos por capacidades detectadas, não só nome da marca |

## O que migramos no código até a revisão 0.3.2
1. Interface em PT-BR parcialmente traduzida e gerenciamento de plugins ARM64 experimental.
2. Fonte Android remoto para RTMP listener, UDP/RTSP e rede USB compatível (não é scrcpy tradicional; não implica cabo USB autoidentificável).
3. Mitigação de menus Qt que causavam travamento de submenu.
4. Prévia desligada durante streaming/gravação, sem desligar a saída.
5. Telemetria periódica de FPS do OBS e quadros perdidos.
6. CBR MediaCodec, reconexões mais persistentes e bitrate dinâmico como padrão de novas configurações.
7. Autoplay no navegador WebView para facilitar páginas com vídeo (não adiciona áudio PCM da página).

## Prioridades de trabalho (ordem de entrega)
**P0: Confiabilidade para live**: medir FPS real, tempo de renderização, quadros ignorados, quedas no envio, upload e latência; recuperar travamentos e evitar regressões. Validar transmissão de 15–30 min e cenas com RedMagic 11.

**P1: Interface e plataformas**: interface de câmera Camera2/UVC; fontes navegador com nomes TikFinity e OWN3D, colar URLs (sem capturar senhas), testar vídeos e alertas, importação seletiva de cenas do Ubuntu; integração RTMP personalizada legítima.

**P1: HUD de métricas**: janela flutuante Android opcional (SYSTEM_ALERT_WINDOW com consentimento), mostra FPS do OBS e perdas; só chamar de FPS do jogo se houver medição independente e autorizada.

**P2: Hardware por dispositivo**: consultar MediaCodecList e VideoCapabilities para perfil, taxa de bits, 1080p60 e Surface mode; medir Qualcomm, MediaTek e outros separadamente, com fallback seguro sem desativar proteções térmicas.

**P2: Recepção por USB/Wi-Fi**: priorizar captura UVC ou rede USB quando suportadas; aceitar H.264/AAC via RTMP/UDP, reduzir buffer e reconectar. Scrcpy tradicional exige ADB; não prometer espelhamento automático de um cabo comum.

**P3: Plugins e acabamento**: importação/compatibilidade ARM64, áudio de navegador/overlays, OBS WebSocket se compilado e testado, verificação UI e recursos externos; não prometer que .so de Linux funcione no Android.

## Aceite
- O APK abre e não cai ao acessar menus, câmera e fontes navegador.
- A live funciona após ficar com a tela do OBS em segundo plano sem encerrar o serviço, respeitando as regras Android.
- Métricas mostram separadamente FPS do OBS, FPS da captura quando disponível e perdas de rede.
- OWN3D e TikFinity mostram conteúdo em teste real; áudio e TTS só entram na lista de suportados após validação.
- O app não consome CPU/GPU excessivamente e não tenta remover limitações térmicas.
- Uma configuração 1080p60 só é marcada estável se transmitida e medida durante teste prolongado sem perdas relevantes.

**Restrição**: manter o código de origem e licenças do OBS e outros componentes. Sem copiar credenciais, dados privados ou plugins proprietários não redistribuíveis.