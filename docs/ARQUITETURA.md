# Lan House PS5: arquitetura

Site para alugar minutos de um PS5 por Pix. Um console, um jogador por vez, fila por ordem de pagamento.

## Peças

```
Navegador do jogador ──HTTPS──► Servidor do site (Node) ◄──heartbeat── PC ligado ao PS5
        │                          │  fila, turnos, Pix, painel          │
        │                          ▼                                      │ chiaki-ng (Remote Play)
        └──── vídeo + controle (etapa 2, WebRTC) ◄────────────────────────┘ + controle virtual (ViGEm)
```

1. **Servidor do site** (esta pasta, `server/`): Node 24, sem dependências externas, SQLite embutido (`node:sqlite`).
   - `lanhouse.js`: regras da fila (puro, testado em `test/`).
   - `pix.js`: provedores de Pix. `mock` para desenvolver; `mercadopago` para cobrar de verdade (ainda não testado com credenciais reais).
   - `index.js`: API HTTP, estado ao vivo por SSE, painel do dono, arquivos de `public/`.
   - `messages.js`: catálogo de mensagens e e-mails por idioma (pt e en). Os erros (`LanHouseError`) guardam a chave e os parâmetros; a resposta sai no idioma do cabeçalho `x-lang` da requisição (padrão pt).
2. **Front-end** (`site/` gera `public/` com `npm run build`): telas simples em Tailwind (CDN), com paleta rosa/laranja/ciano sobre roxo definida em `site/head.html`. A primeira versão veio do Stitch (projeto "Lan House PS5") e foi descartada por ser carregada demais e ter textos falsos. Contas e login em `server/accounts.js`; o apelido da conta é o que aparece na fila. Dois idiomas: `site/pages/<id>.html` gera `public/<id>.html` (pt, em `/`) e `site/pages/<id>.en.html` gera `public/en/<id>.html` (en, em `/en/`); o JavaScript pega os textos de `public/js/i18n/<idioma>.js` com `LH.t()` e monta links com `LH.url()`. O painel do dono fica só em português.
3. **PC do console** (`host-agent/`): chiaki-ng (Remote Play) mostra o PS5 numa janela; o FFmpeg captura a janela e publica no MediaMTX por WebRTC (WHIP); o agente (`agent.py`) recebe os botões do site por WebSocket (`/ws/host`) e aperta um DualShock 4 virtual (ViGEmBus) que o chiaki-ng repassa ao PS5. O navegador lê o vídeo por WHEP e manda os botões por `/ws/play`. Detalhes e passos em `docs/INSTALACAO-NO-PS5.md`.

## Regras de negócio (já implementadas e testadas)

- Pedido nasce `pending` com Pix válido por `PIX_EXPIRES_MIN` minutos; vira `paid` quando o provedor confirma.
- Confirmação é **idempotente** (webhook repetido não duplica a fila) e confere o **valor** pago.
- Pix pago depois do prazo ainda entrega o tempo (o dinheiro entrou).
- **Leilão.** Quem paga mais **por minuto** passa na frente (R$ 25 por 15 min = R$ 1,67/min passa R$ 10 por 10 min = R$ 1,00/min); empate: quem deu o lance antes. A comparação usa inteiros (sem arredondar). Um lance **nunca interrompe** quem já está jogando.
- Lance: 5 a 60 min (de 5 em 5), valor em reais inteiros, piso de R$ 1,00/min e teto de R$ 200 (tudo em `.env`). O Pix é do valor total, pago adiantado.
- **Aumentar lance:** a pessoa informa os novos totais e paga só a diferença; ao pagar, o lance sobe e é reposicionado. Se o turno já tiver começado quando o Pix cair, o que foi pago vira um lance novo (se houver minutos a mais); aumento só de valor sobre turno já iniciado não compra nada e precisa de devolução manual.
- **Fila grátis:** turno fixo de 10 min, uma vaga por conta, espera de 60 min entre turnos da mesma conta, fila de até 20. Entra na rotação: depois de 3 turnos pagos vem 1 grátis (`FREE_EVERY`; 0 = grátis só quando não há pagantes). Sem pagantes, o grátis joga na hora.
- A ordem exibida é a **prevista**: um lance novo pode mudar tudo. O turno começa só se o console estiver **online**; se o PC do PS5 cair, o tempo comprado fica guardado e não queima.
- Estado público nunca expõe e-mail, id de usuário/pedido nem código Pix. Quem comprou é identificado pela sessão (cookie), não por token no navegador. O canal de controle da etapa 2 usa `isActiveUser(userId)`.
- **Relógio:** se o console cair no meio do turno, o relógio de quem joga **pausa** (`clockPaused` no estado público) e o tempo parado é devolvido; o mesmo vale para o tempo em que o servidor ficou fora do ar. Ao juntar aumentos, um turno nunca passa de `BID_MAX_MINUTES`: o excedente vira uma entrada nova.
- **Batimento dos WebSockets:** o servidor manda ping a cada 15 s e derruba quem não responde. A resposta (`pong`) é registrada em cada conexão nova (`trackAlive` em `server/play.js`); um erro antigo registrava só no evento `connection`, que não dispara com `noServer`, e derrubava o PC do console a cada ~30 s (teste de regressão em `test/play.test.js`).
- **Confirmar e-mail:** `register` cria a conta com `email_verified_at` vazio e sem sessão; o código (tabela `verify_codes`, só o hash) ativa a conta e já faz o login. Refazer o cadastro de um e-mail não confirmado substitui o registro anterior (o dono do e-mail nunca fica preso); contas não confirmadas somem em 2 h. Contas de bancos antigos contam como confirmadas (migração em `openDb`). `REQUIRE_EMAIL_VERIFICATION=false` desliga, só para teste local.
- **Aumento de lance só vale depois de pago:** o Pix pendente não muda lance nem posição. Se o Pix de um aumento só de valor cai depois de o turno já ter começado, nada é comprado: `orders.refund_cents` guarda o valor, o painel do dono lista em "Devoluções a fazer" (botão "Já devolvi") e a pessoa vê o aviso em Minhas compras. Aumento com minutos a mais vira um lance novo.
- **Apagar conta** anonimiza o apelido em pedidos e fichas (`conta apagada`); os valores ficam para o financeiro.
- No máximo 3 fichas simultâneas por pessoa; um novo Pix cancela o pendente anterior da mesma pessoa.
- Webhook do Mercado Pago: o corpo do aviso **não é confiável**; o status real vem de uma consulta à API do provedor.

## Segurança do PS5

- O jogador nunca recebe a senha da PSN nem acesso à conta; ele só manda botões pelo PC.
- Use uma **conta PSN separada** da principal para o console da lan house.
- Bloquear loja, configurações e amigos no repasse de controle (etapa 2).

## Etapas

1. **Site, leilão, contas, Pix e painel** (pronto).
2. **Vídeo e controle** (escrito; falta provar com o PS5): chiaki-ng no PC, captura e WebRTC por MediaMTX, controle virtual por ViGEm, só para o jogador da vez (`isActiveUser`).
3. **Operação**: HTTPS, domínio, backup do banco, Mercado Pago em produção, notas fiscais.

## Pendências e riscos conhecidos

- Termos da Sony (uso pessoal do Remote Play) e licença dos jogos: confira antes de cobrar.
- Fiscal: receber Pix de várias pessoas tem implicação tributária; consulte um contador.
- `MercadoPagoPix` nunca foi executado contra a API real.
- Sem reembolso automático quando o admin cancela uma entrada.
