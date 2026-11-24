# Lan House PS5

Site para alugar minutos de um PS5 em formato de leilão: cada pessoa dá um lance (valor por minutos), paga no Pix e entra na fila; quem paga mais por minuto passa na frente. Há também uma fila grátis de 10 minutos. Visual em rosa, laranja e ciano sobre roxo escuro (só as cores; sem logo, nome ou arte de nenhum jogo).

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

## Rodar

Precisa de Node 24 ou mais novo. Sem dependências para instalar.

```powershell
cd lanhouse-ps5
Copy-Item .env.example .env      # depois edite ADMIN_PASSWORD e HOST_SECRET
npm test                         # 44 testes (leilão, fila grátis, turnos, contas, controles, canal de botões)
npm run build                    # gera public/*.html a partir de site/
npm start                        # http://localhost:3000
```

Com `PIX_PROVIDER=mock` (padrão) o Pix é de mentira: ao gerar o Pix aparece o botão "Simular pagamento".
Para o console aparecer como online sem o PC do PS5, simule o batimento (a cada 5 s):

```powershell
curl.exe -X POST http://localhost:3000/api/console/heartbeat -H "x-host-secret: SEU_HOST_SECRET" -H "Content-Type: application/json" -d "{\"online\":true}"
```

Para mostrar o jogo na tela principal: `WHEP_URL` (vídeo de baixa latência do PS5, veja os guias abaixo) ou, como alternativa, `STREAM_EMBED_URL` (endereço de "embed" https de uma live na Kick/Twitch/YouTube). Sem nenhum dos dois aparece "Transmissão ainda não conectada".

**Guias:** [`docs/TESTE-LOCAL.md`](docs/TESTE-LOCAL.md) (testar aqui, sem o PS5) e [`docs/INSTALACAO-NO-PS5.md`](docs/INSTALACAO-NO-PS5.md) (instalar onde está o PS5).

## Pacotes para instalar

`npm run package` monta dois zips em `dist/` (com `SHA256SUMS.txt`), sem segredos, bancos de dados, `node_modules`, `.venv` nem executáveis de terceiros:

| Pacote | Vai para | Como instalar |
|---|---|---|
| `lanhouse-ps5-host.zip` | o PC que fica junto do PS5 | `instalar.ps1` confere Python e FFmpeg, instala as bibliotecas, baixa o MediaMTX **conferindo o SHA-256** e cria o `config.ps1`; depois `iniciar-tudo.ps1`, `parar-tudo.ps1` e `diagnostico.ps1` |
| `lanhouse-ps5-site.zip` | o servidor do site | `instalar-site.ps1` confere o Node 24+, instala a dependência e cria o `.env` com **senhas aleatórias**; depois `iniciar-site.ps1` |

O instalador testado numa pasta limpa: instalação, `iniciar-tudo` (vídeo com imagem de teste + som + agente em simulação), painel do dono mostrando "PC do console: pronto" e `parar-tudo`. Não foi testado com o chiaki-ng, o PS5 nem o driver ViGEmBus. Cada pacote tem um `LEIA-ME.txt`.

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

O que falta é a prova com o PS5 de verdade: vídeo, controle virtual e atraso. O roteiro está em `docs/INSTALACAO-NO-PS5.md`.

## Segurança do que existe

- Senha com scrypt e sal; sessão em cookie `HttpOnly` + `SameSite=Lax` (só o hash fica no banco); cabeçalho `x-lh` nas ações para barrar pedidos de outros sites.
- Login: 5 senhas erradas bloqueiam a conta por 15 minutos (o aviso diz quantas tentativas restam; a mensagem é a mesma para e-mail que não existe). O bloqueio fica no banco e sobrevive a reiniciar o servidor. Há também limite por IP, no cadastro, na compra e na troca/apagar senha.
- Cadastro: a conta só entra depois de confirmar o e-mail com um código de 6 dígitos (15 min, uso único, 5 tentativas, 3 códigos por hora por e-mail). Quem acerta a senha de uma conta não confirmada é mandado para a tela do código.
- Recuperar senha: código de 6 dígitos (guardado só como hash), vale 15 minutos, 5 tentativas, uso único, no máximo 3 códigos por hora por e-mail; a resposta é igual exista a conta ou não. Ao trocar, todas as sessões caem e o bloqueio de login é limpo.
- Painel do dono (5 erros) e segredo do PC do console (10 erros) também bloqueiam por tempo.
- Ao trocar a senha, as outras sessões caem. Apagar conta exige senha e não é possível com ficha na fila.
- Estado público (fila e jogador atual) nunca mostra e-mail, id ou código Pix.
- Em produção use HTTPS e `COOKIE_SECURE=true`. Se ficar atrás de proxy, os limites por IP passam a ver o IP do proxy: ajuste antes de abrir ao público.

## Licença

Copyright (C) 2026 Sandro Moraes. Distribuído sob a **GNU Affero General Public License v3.0 ou posterior** (veja `LICENSE` e `NOTICE`).

Em resumo: você pode usar, estudar, modificar e até cobrar pelo serviço, **mas** precisa manter o aviso de copyright e, se modificar o programa e colocá-lo no ar para outras pessoas, deve publicar o código-fonte da sua versão sob a mesma licença (preencha `SOURCE_URL` no `.env` para mostrar o link no rodapé). Isto não é aconselhamento jurídico. O projeto é independente e não tem vínculo com a Sony nem com as desenvolvedoras dos jogos.

## Estrutura

- `server/`: API (`index.js`), fila (`lanhouse.js`), contas e controles (`accounts.js`), Pix (`pix.js`), configuração e preços (`config.js`).
- `server/messages.js`: mensagens do servidor e e-mails em português e inglês.
- `site/`: cabeçalho, rodapé, tema (cores em `head.html`) e uma página por arquivo, em português (`<id>.html`) e inglês (`<id>.en.html`); `scripts/build.js` gera `public/` (pt) e `public/en/` (en).
- `public/js/`: um arquivo por tela; textos em `public/js/i18n/pt.js` e `en.js`. `docs/ARQUITETURA.md`: desenho e regras. `host-agent/`: plano do PC do console.

## Antes de abrir ao público

1. Termos da Sony e das desenvolvedoras: confira se alugar o console é permitido. Use uma conta PSN separada.
2. Pix real: teste o Mercado Pago com credenciais de teste, depois produção. Defina `PUBLIC_BASE_URL` com HTTPS.
3. Troque `ADMIN_PASSWORD` e `HOST_SECRET`. O painel de admin usa uma senha única; coloque o site atrás de HTTPS.
4. O Tailwind vem do CDN (`cdn.tailwindcss.com`), bom para começar; para produção, compile o CSS.
5. LGPD: o site guarda e-mail, apelido e histórico de compras. Tenha uma política de privacidade e um jeito de atender pedidos de exclusão (a pessoa já pode apagar a própria conta).
6. Fiscal: receber Pix de várias pessoas tem implicação tributária.
7. O 18+ é uma confirmação por marcação, não há verificação de idade.
