# Handoff: versão em inglês (i18n) do Lan House PS5

Gerado em 24/11/2026 porque a sessão anterior passou de 29% da janela de contexto. Projeto: `C:\Users\sandr\lanhouse-ps5` (repositório git próprio, **sem nenhum commit ainda**; o usuário pediu para NÃO commitar antes desta tarefa e só depois decide).

## Pedido do usuário (última mensagem)
"Antes do commit queria fazer uma versão português lan house porém uma em inglês também." = manter o site em português (tema lan house, já existente) e ter uma versão completa em inglês.

## Estado do projeto (tudo verde)
- `npm test`: 121 testes passam (inclui `FUZZ_SEEDS` padrão 30). `node scripts/build.js` gera `public/*.html` a partir de `site/`. `npm run package` gera `dist/*.zip` (site e host) e confere arquivos proibidos.
- Feito antes: contas, login com bloqueio (5 erros), recuperar senha por código, **confirmação de e-mail por código no cadastro**, Pix (QR conferido), leilão/fila, aumento de lance só vale pago (+ "Devoluções a fazer" no painel), páginas de Termos e Privacidade (pt-BR), licença **AGPL-3.0** (LICENSE, NOTICE, README), pacotes.
- Nada de Mercado Pago real nem SMTP real foi testado.

## Decisões propostas para o i18n (o usuário não escolheu; usar estas, salvo objeção)
- Português fica em `/` (como hoje); inglês em `/en/`. Seletor de idioma no cabeçalho (PT | EN) que leva para a mesma página no outro idioma; lembrar a escolha em `localStorage` e, só na primeira visita sem escolha, mandar para `/en/` se `navigator.language` começar com `en`.
- O painel do dono (`admin.html`) continua só em português.
- Build: `scripts/build.js` passa a gerar as duas árvores. Páginas por idioma: `site/pages/<id>.html` (pt) e `site/pages/<id>.en.html` (en) -> `public/<id>.html` e `public/en/<id>.html`; `site/header|footer|head` também por idioma (`*.en.html`), `<html lang>` certo, rótulos do menu (Play/Controls/Account) e links internos com prefixo `/en/`.
- JS do cliente: dicionários `public/js/i18n/pt.js` e `en.js` (objeto de chaves) + função `LH.t(chave, params)`; idioma lido de `document.documentElement.lang`. Trocar as strings fixas de `common.js`, `index.js`, `play.js`, `controles.js`, `conta.js`, `auth.js`, `recuperar.js`, `confirmar.js`, `legal.js` (e as mensagens de `whep.js`, se houver). Redirecionamentos (`/entrar.html`, `next=`, etc.) precisam manter o prefixo `/en/`.
- Servidor: erros são `LanHouseError(code, message, status)` em `server/accounts.js` (20), `lanhouse.js` (14), `index.js` (15), `security.js` (1): ~28 códigos distintos. Criar `server/messages.js` com catálogo por idioma (chave = `code` + parâmetros), o cliente manda o idioma no cabeçalho `x-lang: en|pt` (em `LH.api`), o servidor escolhe o texto; padrão pt. Mensagens com número (tentativas restantes, minutos de espera) devem receber parâmetros. E-mails (`server/mailer.js`: código de recuperar senha e de confirmar e-mail) saem no idioma da requisição que os gerou.
- Termos e privacidade: traduzir para inglês (`termos.en.html`, `privacidade.en.html`) mantendo o conteúdo e dizendo que a lei aplicável é a brasileira; nome do operador e e-mail continuam vindo de `OPERATOR_NAME`/`CONTACT_EMAIL`.
- Testes novos: paridade de chaves pt x en nos dicionários do cliente e do servidor; toda página pt tem a versão `/en/`; links internos de `/en/` não caem em páginas pt; erro do servidor sai em inglês com `x-lang: en`; e-mail em inglês; página `/en/` carrega `lang="en"`.
- Docs: README (idiomas), ARQUITETURA, `.env.example` não muda; incluir na LEIA-ME do pacote do site. Rodar `npm test`, `node scripts/build.js`, `npm run package` e conferir o zip.

## Arquivos de interesse
- `scripts/build.js` (gera as páginas), `site/*.html`, `site/pages/*.html`, `public/js/*.js`, `server/index.js` (rotas e `send`), `server/accounts.js`, `server/lanhouse.js`, `server/mailer.js`, `test/*.test.js`.
- Cuidado ao editar com Python em heredoc no Bash: barras invertidas e `'''` quebram; escreva o script com a ferramenta Write e rode o arquivo.

## Regras do usuário a manter
Responder em português do Brasil; nada de commit sem pedir; não publicar nada; arte/visual próprios (sem copiar jogargta); sem texto falso (nada de promessa que o sistema não cumpre).
