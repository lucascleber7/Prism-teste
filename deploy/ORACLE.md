# Live 24h no Oracle Cloud grátis (pelo celular)

Resultado: uma máquina na nuvem que transmite o jogo para o Restream o tempo todo, em 720×1280 a 30 fps.
Você precisa do celular com o Termux, do endereço + chave do Restream e do seu @ do TikTok.

## 1. Criar a conta

1. Abra **oracle.com/cloud/free** e toque em **Start for free**.
2. A Oracle pede um cartão **só para verificar** a conta. Os recursos "Always Free" não são cobrados enquanto você ficar dentro do limite.
3. Em **Home Region**, escolha **Brazil East (Sao Paulo)**. Essa escolha não muda depois.

## 2. Criar a chave de acesso no Termux

```bash
pkg install -y openssh
ssh-keygen -t ed25519        # aperte Enter em todas as perguntas
cat ~/.ssh/id_ed25519.pub    # copie a linha inteira que aparecer
```

## 3. Criar a máquina

No painel da Oracle: **Menu ☰ → Compute → Instances → Create instance**.

- **Image**: Canonical **Ubuntu 24.04**.
- **Shape**: **Change shape → Ampere → VM.Standard.A1.Flex**, com **2 OCPU** e **12 GB** de memória. Esse é o limite grátis atual; mais que isso é cobrado. Confira se aparece **Always Free-eligible**.
- **Add SSH keys**: **Paste public keys** e cole a linha copiada no passo 2.
- Toque em **Create**. Se aparecer **Out of capacity**, tente de novo mais tarde ou escolha outro *Availability domain*.

Quando ficar **Running**, copie o **Public IP address**.

## 4. Entrar na máquina e ligar a live

No Termux (troque `IP` pelo número copiado):

```bash
ssh ubuntu@IP
```

Já dentro da máquina, cole estes 3 comandos:

```bash
curl -fsSL https://github.com/lucascleber7/Prism-teste/archive/refs/heads/abyss-live-24h.tar.gz -o abyss-live.tar.gz
mkdir -p abyss-live && tar xzf abyss-live.tar.gz --strip-components=1 -C abyss-live
cd abyss-live && sudo bash deploy/instalar-servidor.sh
```

O instalador pergunta:

- **seu @ do TikTok**, sem o @;
- **endereço + chave do Restream, tudo junto, com uma barra no meio**: `rtmp://live.restream.io/live/` seguido da chave. A chave **não aparece** enquanto você cola; é normal.

A primeira montagem leva alguns minutos. Depois a live sobe sozinha e volta sozinha se cair ou se a máquina reiniciar.

## 5. Conferir

```bash
cd ~/abyss-live && sudo docker compose logs -f --tail 50
```

A cada 30 s aparece uma linha com `fps=30` e `speed=1.0x` (ou perto disso). Para sair do log sem parar a live: **Ctrl+C**.
No painel do Restream o vídeo deve aparecer como recebido.

## Comandos do dia a dia (dentro de `~/abyss-live`)

| Para | Comando |
|---|---|
| ver o log | `sudo docker compose logs -f --tail 50` |
| parar a live | `sudo docker compose down` |
| ligar de novo | `sudo docker compose up -d` |
| trocar o @ ou a chave | `sudo REWRITE_ENV=1 bash deploy/instalar-servidor.sh` |

## Avisos

- **Máquina parada é recolhida**: a Oracle pode recolher máquinas grátis que ficam 7 dias quase sem uso (CPU abaixo de 20%). Com a live rodando isso não acontece. Se você parar a live por mais de uma semana, a máquina pode ser apagada.
- **Não aumente a máquina** além de 2 OCPU e 12 GB: passa do limite grátis.
- **Nenhuma porta precisa ser aberta**: a página do jogo só existe dentro da máquina.
- **Chave**: quem tem a chave transmite no seu canal. Ela fica só no arquivo `.env` da máquina, que só o administrador lê.
