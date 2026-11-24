# Lan House PS5

**Português** | [English](README.en.md)

![Licença: AGPL-3.0-or-later](https://img.shields.io/badge/licen%C3%A7a-AGPL--3.0--or--later-blue) ![Node 24+](https://img.shields.io/badge/node-%3E%3D24-339933) ![Testes: 132 passam](https://img.shields.io/badge/testes-132%20passam-brightgreen)

Site para alugar minutos de um PS5 em formato de leilão: cada pessoa dá um lance (valor por minutos), paga no Pix e entra na fila; quem paga mais por minuto passa na frente. Há também uma fila grátis de 10 minutos.

## Visão geral

Alugar o console por tempo costuma ser resolvido com ordem de chegada ou combinado no WhatsApp, e quem paga mais não tem como "furar" a fila de forma justa. Aqui a regra é pública e simples: a fila é ordenada pelo **preço por minuto**, o pagamento é adiantado por Pix, e um lance maior **nunca interrompe** quem já está jogando. Sem pagantes na fila, a fila grátis ocupa o console.

O projeto tem três peças: o **site** (Node, com contas, leilão, Pix e painel do dono), o **PC do console** (um agente que recebe os botões do site e aperta um controle virtual, mais o vídeo e o som em WebRTC) e os **guias** de instalação. O visual usa rosa, laranja e ciano sobre roxo escuro (só as cores; sem logo, nome ou arte de nenhum jogo).

> **Estado, sem rodeio:** o site, o leilão, as contas e o painel estão prontos e testados (132 testes). O que depende do equipamento real **nunca foi provado**: o PS5, o chiaki-ng e o controle virtual (ViGEmBus) nunca rodaram com o sistema. O **Mercado Pago real e o envio de e-mail por SMTP real nunca foram testados** com credenciais de verdade; o Pix padrão é de mentira (`PIX_PROVIDER=mock`). Veja [Estado do projeto](#estado-do-projeto) e [Antes de abrir ao público](#antes-de-abrir-ao-público).

Este repositório não tem capturas de tela nem demonstração publicada.

## Idiomas

O site tem duas versões completas: **português** em `/` (tema lan house) e **inglês** em `/en/` (`/en/entrar.html`, `/en/termos.html` etc.).

- O seletor **PT | EN** no cabeçalho leva para a mesma página no outro idioma e guarda a escolha no navegador. Na primeira visita, quem usa o navegador em inglês vai direto para `/en/`.
- Mensagens do servidor (erros, avisos) e os e-mails de código saem no idioma da página: o navegador manda o cabeçalho `x-lang` (`pt` ou `en`; sem ele, português).
- Termos e Privacidade em inglês são tradução de cortesia: a versão em português prevalece e a lei aplicável é a brasileira.
- O painel do dono (`/admin.html`) existe só em português.
- Onde ficam os textos: páginas em `site/pages/<id>.html` (pt) e `site/pages/<id>.en.html` (en); cabeçalho e rodapé em `site/header.html`/`header.en.html` e `site/footer.html`/`footer.en.html`; textos do JavaScript em `public/js/i18n/pt.js` e `en.js` (usados com `LH.t('chave')`); mensagens do servidor e e-mails em `server/messages.js`. Os testes (`test/i18n.test.js`) conferem que os dois idiomas têm as mesmas chaves e páginas.

## Telas

| Tela | O que tem |
|---|---|
| `/` Jogar | Vídeo ao vivo grande; embaixo, quem está jogando com o cronômetro; à direita, a fila do leilão, o lance (com simulação da posição), aumentar lance e a fila grátis |
| `/controles.html` | Mapa de teclas e de botões do controle (Gamepad), com teste ao vivo; salvo na conta |
| `/conta.html` | Apelido, trocar senha, histórico de compras, apagar conta |
| `/entrar.html` e `/criar-conta.html` | Login e cadastro (e-mail e repetição, apelido, senha e repetição, confirmação de 18+) |
| `/confirmar-email.html` | Depois de criar a conta: código de 6 dígitos enviado ao e-mail para ativá-la |
| `/recuperar-senha.html` | Esqueci a senha: código de 6 dígitos por e-mail e senha nova |
| `/termos.html` e `/privacidade.html` | Termos de uso e Política de privacidade (LGPD); o nome e o e-mail do operador vêm do `.env` |
| `/admin.html` | Painel do dono (senha própria, fora do menu; só em português) |

Todas as telas, menos o painel do dono, também existem em inglês com o prefixo `/en/`.

## Stack

| Camada | Tecnologia |
|---|---|
| Servidor | Node 24+, HTTP próprio (`server/index.js`), estado ao vivo por SSE, WebSocket (`ws`) para o canal de botões |
| Dados | SQLite embutido do Node (`node:sqlite`), arquivo em `data/lanhouse.db` |
| Front-end | HTML e JavaScript sem framework, Tailwind pelo CDN, páginas geradas por `scripts/build.js` a partir de `site/` |
| Pix | `mock` (desenvolvimento) ou Mercado Pago (escrito, nunca executado contra a API real); QR desenhado no navegador (`qrcode-generator`) |
| E-mail | `nodemailer`: `console` (o código aparece no log) ou `smtp` |
| Vídeo e som | chiaki-ng (Remote Play) + FFmpeg + MediaMTX, WebRTC (WHIP/WHEP) |
| Controle virtual | Agente em Python (`host-agent/`): `websockets`, `numpy`, `soundcard`, `vgamepad` (ViGEmBus) |
| Testes | `node --test` (132 testes), `jsqr` para ler o QR de volta |

## Arquitetura

```
Navegador do jogador ──HTTPS──► Servidor do site (Node) ◄──heartbeat── PC ligado ao PS5
        │                          │  fila, turnos, Pix, painel          │
        │                          ▼                                      │ chiaki-ng (Remote Play)
        └──── vídeo + controle (WebRTC e WebSocket) ◄─────────────────────┘ + controle virtual (ViGEm)
```

1. **Servidor do site** (`server/`): `lanhouse.js` guarda as regras da fila (puras, testadas); `pix.js` traz os provedores de Pix; `accounts.js`, contas e controles salvos; `play.js`, o canal de botões; `messages.js`, mensagens e e-mails em pt e en; `index.js`, a API, o painel e os arquivos de `public/`.
2. **Front-end** (`site/` gera `public/` com `npm run build`): telas simples, paleta definida em `site/head.html`. O apelido da conta é o que aparece na fila.
3. **PC do console** (`host-agent/`): o chiaki-ng mostra o PS5 numa janela; o FFmpeg captura a janela e publica no MediaMTX (WHIP); o agente recebe os botões do site por WebSocket (`/ws/host`) e aperta um DualShock 4 virtual, que o chiaki-ng repassa ao PS5. O navegador lê o vídeo por WHEP e manda os botões por `/ws/play`, só para o jogador da vez.

Regras de negócio já implementadas e testadas (detalhes em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md)):

- O Pix nasce `pending` e vira `paid` quando o provedor confirma; a confirmação é **idempotente** e confere o **valor** pago. Pix pago depois do prazo ainda entrega o tempo.
- O turno começa só se o console estiver **online**; se o PC do PS5 cair, o tempo comprado fica guardado e o relógio de quem joga **pausa**.
- O estado público nunca mostra e-mail, id ou código Pix. Quem comprou é identificado pela sessão (cookie).
- Aumento de lance só vale depois de pago; aumento só de valor sobre turno já iniciado não compra nada e vai para "Devoluções a fazer" no painel do dono.
- O aviso do Mercado Pago não é confiável por si: o status real vem de uma consulta à API do provedor.
- Apagar a conta anonimiza o apelido em pedidos e fichas; os valores ficam para o financeiro.

## Regras do leilão (todas ajustáveis no `.env`)

- Lance de 5 a 60 min (de 5 em 5), em reais inteiros, piso de **R$ 1,00 por minuto** (R$ 10 por 10 min é o menor lance) e teto de R$ 200.
- A fila é ordenada pelo **preço por minuto**; empate fica com quem deu o lance antes. Um lance maior **nunca interrompe** quem já está jogando.
- Dá para **aumentar o lance** na fila: paga só a diferença e sobe de posição. A tela mostra onde o lance ficaria antes de pagar e quanto falta para ser o 1º.
- **Fila grátis:** 10 min, uma vaga por conta, 60 min de espera entre turnos da mesma conta; depois de 3 turnos pagos entra 1 grátis (`FREE_EVERY=0` = grátis só quando não há pagantes).
- Quem é ultrapassado vê um aviso na tela. Não há reembolso de lance (o dono pode devolver manualmente pelo Pix).

## Estado do projeto

| Parte | Situação |
|---|---|
| Contas, login, sessão, controles salvos | Pronto e testado |
| Leilão, fila grátis, turnos, relógio, painel do dono | Pronto e testado |
| Pix de mentira (desenvolvimento) | Pronto |
| Pix real (Mercado Pago) | Escrito, **nunca executado** contra a API real |
| Canal de botões (site → servidor → agente), com soltar tudo ao trocar a vez, fechar a aba ou cair a conexão | Pronto e testado (agente em simulação) |
| Agente do PC do console, scripts de vídeo, guias | Escritos; **nunca rodaram com o PS5, o chiaki-ng nem o ViGEmBus** |
| Vídeo WebRTC (WHEP/WHIP) com MediaMTX | Testado com imagem de teste: aparece no site, detecta congelamento/queda e se recupera sozinho. Falta provar com a captura do chiaki-ng e medir o atraso |
| Áudio do jogo (loopback do Windows → site) | Testado com um tom: chega ao navegador. Falta provar com o som real do chiaki-ng e a sincronia com o vídeo |
| Recuperar senha por código no e-mail | Pronto e testado com o e-mail simulado (o código aparece no log do servidor). **O envio SMTP real nunca foi testado**: configure `MAIL_PROVIDER=smtp` e teste com o seu e-mail antes de abrir |
| QR do Pix | O QR é desenhado no navegador a partir do "copia e cola"; testado lendo o QR de volta e conferindo valor e CRC. Com Mercado Pago, um código com valor errado ou CRC inválido é recusado. Falta pagar um Pix real |
| Confirmar e-mail no cadastro | Pronto e testado (com o e-mail simulado). A conta nasce sem acesso até digitar o código; conta que nunca confirma some em 2 h |
| Termos de uso e Política de privacidade | Modelos escritos conforme o que o sistema faz de verdade. **Não são aconselhamento jurídico**: leia, ajuste ao seu caso (devolução, prazos, CNPJ) e, se puder, passe por um advogado antes de abrir ao público |
| Trocar e-mail da conta | Não feito (de propósito) |

O que falta é a prova com o PS5 de verdade: vídeo, controle virtual e atraso. O roteiro está em [`docs/INSTALACAO-NO-PS5.md`](docs/INSTALACAO-NO-PS5.md).

## Como rodar

Precisa de Node 24 ou mais novo.

```powershell
cd lanhouse-ps5
npm install                      # ws e nodemailer (mais jsqr e qrcode-generator, só para os testes)
Copy-Item .env.example .env      # depois edite ADMIN_PASSWORD e HOST_SECRET
npm test                         # 132 testes (leilão, fila grátis, turnos, contas, controles, canal de botões, idiomas)
npm run build                    # gera public/*.html a partir de site/
npm start                        # http://localhost:3000
```

Com `PIX_PROVIDER=mock` (padrão) o Pix é de mentira: ao gerar o Pix aparece o botão "Simular pagamento". Com `MAIL_PROVIDER=console` (padrão) nenhum e-mail é enviado: o código de confirmação aparece no terminal do servidor.

Para o console aparecer como online sem o PC do PS5, simule o batimento (a cada 5 s):

```powershell
curl.exe -X POST http://localhost:3000/api/console/heartbeat -H "x-host-secret: SEU_HOST_SECRET" -H "Content-Type: application/json" -d "{\"online\":true}"
```

Para mostrar o jogo na tela principal: `WHEP_URL` (vídeo de baixa latência do PS5, veja os guias abaixo) ou, como alternativa, `STREAM_EMBED_URL` (endereço de "embed" https de uma live na Kick/Twitch/YouTube). Sem nenhum dos dois aparece "Transmissão ainda não conectada".

**Guias:** [`docs/TESTE-LOCAL.md`](docs/TESTE-LOCAL.md) (testar aqui, sem o PS5) e [`docs/INSTALACAO-NO-PS5.md`](docs/INSTALACAO-NO-PS5.md) (instalar onde está o PS5).

## Testes

```powershell
npm test
```

Cobrem o leilão e a ordem da fila, a fila grátis, turnos e relógio, Pix (inclui leitura do QR e CRC), contas e confirmação de e-mail, segurança (bloqueios e limites), o canal de botões, as rotas HTTP, um teste de variações aleatórias (`fuzz`) e a paridade dos dois idiomas. Os testes não usam o PS5, o Mercado Pago real nem SMTP real.

## Pacotes para instalar

`npm run package` monta dois zips em `dist/` (com `SHA256SUMS.txt`), sem segredos, bancos de dados, `node_modules`, `.venv` nem executáveis de terceiros:

| Pacote | Vai para | Como instalar |
|---|---|---|
| `lanhouse-ps5-host.zip` | o PC que fica junto do PS5 | `instalar.ps1` confere Python e FFmpeg, instala as bibliotecas, baixa o MediaMTX **conferindo o SHA-256** e cria o `config.ps1`; depois `iniciar-tudo.ps1`, `parar-tudo.ps1` e `diagnostico.ps1` |
| `lanhouse-ps5-site.zip` | o servidor do site | `instalar-site.ps1` confere o Node 24+, instala a dependência e cria o `.env` com **senhas aleatórias**; depois `iniciar-site.ps1` |

O instalador foi testado numa pasta limpa: instalação, `iniciar-tudo` (vídeo com imagem de teste + som + agente em simulação), painel do dono mostrando "PC do console: pronto" e `parar-tudo`. Não foi testado com o chiaki-ng, o PS5 nem o driver ViGEmBus. Cada pacote tem um `LEIA-ME.txt`.

## Segurança do que existe

- Senha com scrypt e sal; sessão em cookie `HttpOnly` + `SameSite=Lax` (só o hash fica no banco); cabeçalho `x-lh` nas ações para barrar pedidos de outros sites.
- Login: 5 senhas erradas bloqueiam a conta por 15 minutos (o aviso diz quantas tentativas restam; a mensagem é a mesma para e-mail que não existe). O bloqueio fica no banco e sobrevive a reiniciar o servidor. Há também limite por IP, no cadastro, na compra e na troca/apagar senha.
- Cadastro: a conta só entra depois de confirmar o e-mail com um código de 6 dígitos (15 min, uso único, 5 tentativas, 3 códigos por hora por e-mail). Quem acerta a senha de uma conta não confirmada é mandado para a tela do código.
- Recuperar senha: código de 6 dígitos (guardado só como hash), vale 15 minutos, 5 tentativas, uso único, no máximo 3 códigos por hora por e-mail; a resposta é igual exista a conta ou não. Ao trocar, todas as sessões caem e o bloqueio de login é limpo.
- Painel do dono (5 erros) e segredo do PC do console (10 erros) também bloqueiam por tempo.
- Ao trocar a senha, as outras sessões caem. Apagar conta exige senha e não é possível com ficha na fila.
- Estado público (fila e jogador atual) nunca mostra e-mail, id ou código Pix.
- O jogador nunca recebe a senha da PSN: ele só manda botões pelo PC. Use uma **conta PSN separada** da principal. O botão PS não é repassado, então não dá para sair do jogo, trocar de usuário ou desligar o console pelo controle.
- Em produção use HTTPS e `COOKIE_SECURE=true`. Se ficar atrás de proxy, os limites por IP passam a ver o IP do proxy: ajuste antes de abrir ao público.

## Decisões técnicas

- **Sem framework e quase sem dependências:** o servidor usa o que o Node 24 já traz (`node:sqlite`, `node --test`); só `ws` e `nodemailer` são dependências de execução.
- **SQLite em vez de um servidor de banco:** um console, uma instância, backup por cópia do arquivo `data/lanhouse.db`. Custo: não escala para várias instâncias.
- **Regras da fila em código puro** (`server/lanhouse.js`), comparando inteiros, sem arredondar: dá para testar sem HTTP e sem relógio real.
- **Pagamento adiantado e idempotente:** webhook repetido não duplica a fila, e o valor pago é conferido.
- **Console offline não queima o tempo comprado:** o turno só começa com o PC do console online, e o relógio pausa se ele cair.
- **Controle limitado de propósito:** sem botão PS, sem troca de jogo pelo jogador; só o jogador da vez manda botões, e tudo é solto ao trocar a vez, fechar a aba ou cair a conexão.
- **Duas línguas com teste de paridade:** `test/i18n.test.js` falha se faltar chave ou página em um dos idiomas.

## Estrutura

- `server/`: API (`index.js`), fila (`lanhouse.js`), contas e controles (`accounts.js`), Pix (`pix.js`, `brcode.js`), canal de botões (`play.js`), e-mail (`mailer.js`), segurança (`security.js`), configuração e preços (`config.js`) e mensagens em pt e en (`messages.js`).
- `site/`: cabeçalho, rodapé, tema (cores em `head.html`) e uma página por arquivo, em português (`<id>.html`) e inglês (`<id>.en.html`); `scripts/build.js` gera `public/` (pt) e `public/en/` (en).
- `public/js/`: um arquivo por tela; textos em `public/js/i18n/pt.js` e `en.js`.
- `host-agent/`: o PC do console (agente, scripts de vídeo e som, MediaMTX); veja [`host-agent/README.md`](host-agent/README.md).
- `packaging/` e `scripts/make-package.ps1`: montagem dos zips de instalação.
- `test/`: testes automatizados.
- `docs/`: [`ARQUITETURA.md`](docs/ARQUITETURA.md) (desenho e regras), [`INSTALACAO-NO-PS5.md`](docs/INSTALACAO-NO-PS5.md), [`TESTE-LOCAL.md`](docs/TESTE-LOCAL.md).

## Antes de abrir ao público

1. Termos da Sony e das desenvolvedoras: confira se alugar o console é permitido. Use uma conta PSN separada.
2. Pix real: teste o Mercado Pago com credenciais de teste, depois produção. Defina `PUBLIC_BASE_URL` com HTTPS.
3. E-mail real: configure `MAIL_PROVIDER=smtp` e teste o cadastro e a recuperação de senha com o seu e-mail.
4. Troque `ADMIN_PASSWORD` e `HOST_SECRET`. O painel de admin usa uma senha única; coloque o site atrás de HTTPS.
5. O Tailwind vem do CDN (`cdn.tailwindcss.com`), bom para começar; para produção, compile o CSS.
6. LGPD: o site guarda e-mail, apelido e histórico de compras. Tenha uma política de privacidade e um jeito de atender pedidos de exclusão (a pessoa já pode apagar a própria conta).
7. Fiscal: receber Pix de várias pessoas tem implicação tributária.
8. O 18+ é uma confirmação por marcação, não há verificação de idade.
9. Prove o conjunto com o PS5 de verdade (vídeo, controle virtual, atraso e som) seguindo o roteiro de aceite do guia de instalação.

## Licença

Copyright (C) 2026 Sandro Moraes. Distribuído sob a **GNU Affero General Public License v3.0 ou posterior** (veja `LICENSE` e `NOTICE`).

Em resumo: você pode usar, estudar, modificar e até cobrar pelo serviço, **mas** precisa manter o aviso de copyright e, se modificar o programa e colocá-lo no ar para outras pessoas, deve publicar o código-fonte da sua versão sob a mesma licença (preencha `SOURCE_URL` no `.env` para mostrar o link no rodapé). Isto não é aconselhamento jurídico.

O projeto é independente e não tem vínculo com a Sony nem com as desenvolvedoras dos jogos. "PlayStation" e "PS5" são marcas dos seus donos. Componentes de terceiros mantêm as próprias licenças (lista no `NOTICE`).
