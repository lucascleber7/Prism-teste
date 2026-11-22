# Cabo de Guerra da Live

Jogo de navegador (tela vertical 9:16) controlado pela sua live do TikTok. É a ideia do vídeo "Hora de IA": cada comentário, curtida, presente e novo seguidor cai dentro do jogo em tempo real.

```
live do TikTok ──► server.js (ponte, tiktok-live-connector) ──► /events (SSE) ──► jogo no navegador
```

## Como jogar (regras)

| Na live | No jogo |
|---|---|
| Comentou **AZUL** ou **VERMELHO** (também `1` / `2`) | Entra no time e solta um soldado com a foto e o nome. Repetir o nome do time solta outro (a cada 4 s) |
| Comentou qualquer outra coisa | O comentário aparece num balão em cima do soldado |
| Curtidas | Enchem a barra do time; cheia = **SUPER** (+80% de dano, +30% de velocidade por 6 s) |
| Presente | **Tanque** (até 6 por presente; cresce com o valor em diamantes) |
| Seguiu | **Herói** dourado |
| Compartilhou | Cura a base do time |

Quem zera a base do outro time vence a rodada. Aparece o MVP (mais abates) e, 12 s depois, começa outra rodada.

## Rodar

Precisa do Node 20 ou mais novo (a biblioteca do TikTok exige isso; o modo `--demo` roda sem instalar nada).

```bash
node server.js --demo          # testa sem live: viewers simulados, nenhuma conexão externa
# abra http://127.0.0.1:8787
```

Na live de verdade (você precisa estar **AO VIVO** nesse momento):

```bash
npm install
node server.js @seuperfil
```

Para mostrar na live, use a página `http://127.0.0.1:8787` como fonte de navegador (URL) do OBS ou grave a tela do navegador. O formato é vertical 9:16.

Opções da página: o padrão é **60 fps em 1080×1920**. Em aparelho fraco ou quente use `?fps=30&scale=1.5` (30 fps em 810×1440) ou `?scale=1` (540×960). `?debug` mostra FPS e unidades.
Opções do servidor: `--port 8787`, `--host 127.0.0.1` (padrão), `--key CHAVE` ou variável `EULER_API_KEY` (opcional, veja abaixo).

## Transmitir 24h de um servidor, sem OBS e sem celular

```
servidor (VPS) ─ Xvfb (tela virtual) ─ Chromium (jogo) ─ ffmpeg (H.264 + áudio) ─ RTMP ─► Restream ─► TikTok, YouTube...
                └ server.js lê a live do TikTok e manda os eventos para o jogo
```

No servidor (Ubuntu ou Debian novo), de dentro da pasta do projeto, um comando só:

```bash
sudo bash deploy/instalar-servidor.sh
```

Ele instala o Docker se faltar, pergunta o seu @ e o endereço+chave do Restream (a chave não aparece na tela), grava o `.env` só para o root e escolhe a qualidade pelo número de núcleos: 4 ou mais = 1080×1920 a 60 fps; menos = 720×1280 a 30 fps.

Ou, manualmente:

```bash
cp .env.example .env      # edite: STREAM_URL (endereço + chave do Restream) e TIKTOK_USER (seu @, sem o @)
docker compose up -d --build
docker compose logs -f    # acompanhar; a cada 30 s aparece fps e speed (precisa ficar perto de 1.0x)
docker compose down       # parar a transmissão
```

- O `@` do TikTok é configurado **uma vez** no `.env`. Ele é necessário porque é assim que a biblioteca sabe de qual live ler os comentários. Você não precisa digitar nada a cada live.
- Tudo volta sozinho: se a internet cair, o navegador travar ou o servidor reiniciar, cada peça é religada (`restart: unless-stopped` e o vigia dentro de `stream/stream.sh`).
- A chave de transmissão fica só no `.env` do servidor e aparece como `***` em todos os logs.
- Áudio: vai uma trilha silenciosa, porque as plataformas exigem áudio. Música só se tiver direito de uso.
- Servidor: 1080×1920 a 60 fps usou cerca de 2 núcleos de CPU no teste. Uma VPS de 4 vCPU dá folga. Com 2 vCPU, use `WIDTH=720 HEIGHT=1280 FPS=30`.

## O que você precisa saber antes de usar na live

- **Não é a API oficial do TikTok.** A biblioteca `tiktok-live-connector` (v2.5.0) é feita por engenharia reversa e o próprio README diz que não é para produção. O TikTok pode mudar algo e quebrar a conexão, ou bloquear.
- **"Sem chave oficial" é verdade, mas há um terceiro no meio.** A v2 assina a conexão pelo servidor da Euler Stream, com limites gratuitos. Uma chave dela (`--key`) aumenta os limites. Isso significa que o nome do perfil da live passa por esse serviço.
- **Licença:** a biblioteca é AGPL-3.0. Para uso próprio não há problema. Se um dia você hospedar isso para outras pessoas, a licença exige oferecer o código.
- **Dados dos espectadores:** nome e foto públicos aparecem no jogo. Nada é salvo em disco. O servidor só escuta em `127.0.0.1`; use `--host 0.0.0.0` só se outro aparelho da sua rede precisar abrir o jogo.
- **Não foi testado com uma live real.** O que foi testado: a ponte com uma biblioteca simulada (mesma forma de eventos da v2.5.0), a API, o jogo num navegador headless e 200 eventos de carga. Os nomes dos campos vieram da documentação da biblioteca.

## Testes

```bash
npm test      # ponte, API, biblioteca simulada e (se houver playwright) o jogo no navegador
```

## Personalizar

Tudo está em `public/game.js`, no topo: times e cores (`TEAMS`), tipos de soldado (`KINDS`), limite por time (`MAX_PER_TEAM`), duração do SUPER e da tela de vitória. Para trocar o tema (por exemplo, goblins contra esqueletos do Abyss Rebirth), mude os nomes e as cores e redesenhe `drawUnit` e o fundo (`paintBackground`).
