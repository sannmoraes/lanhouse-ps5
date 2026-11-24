// Gera as paginas do site a partir de site/, em dois idiomas:
//   portugues: site/pages/<id>.html    -> public/<id>.html
//   ingles:    site/pages/<id>.en.html -> public/en/<id>.html
// Cabecalho e rodape tambem tem uma versao por idioma (site/header.en.html, site/footer.en.html).
// O painel do dono (admin) existe so em portugues.
// Uso: node scripts/build.js
import { readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

export const LANGS = {
  pt: { htmlLang: 'pt-BR', prefix: '', out: 'public', suffix: '.html', tabs: ['Jogar', 'Controles', 'Conta'], switchLabel: 'Idioma' },
  en: { htmlLang: 'en', prefix: '/en', out: 'public/en', suffix: '.en.html', tabs: ['Play', 'Controls', 'Account'], switchLabel: 'Language' },
};
// Paginas que existem so em portugues.
export const PT_ONLY = new Set(['admin']);

// Abas do menu. Entrar, Criar conta e o painel do dono ficam fora do menu.
const TAB_IDS = ['index', 'controles', 'conta'];

const TAB_BASE = 'px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors';
const TAB_IDLE = 'text-mute hover:text-ink hover:bg-panel2';
const TAB_ACTIVE = 'bg-panel2 text-pink';

/** Endereco publico da pagina `id` no idioma `lang`. */
export const pageUrl = (lang, id) => `${LANGS[lang].prefix}/${id === 'index' ? '' : `${id}.html`}`;

const nav = (lang, active) =>
  TAB_IDS.map((id, i) => {
    const on = id === active;
    return `<a href="${pageUrl(lang, id)}" class="${TAB_BASE} ${on ? TAB_ACTIVE : TAB_IDLE}"${on ? ' aria-current="page"' : ''}>${LANGS[lang].tabs[i]}</a>`;
  }).join('');

// Seletor PT | EN: leva para a mesma pagina no outro idioma (common.js guarda a escolha).
const langSwitch = (lang, id) =>
  `<span class="flex items-center rounded-md border border-line text-xs font-mono overflow-hidden" role="group" aria-label="${LANGS[lang].switchLabel}">` +
  Object.keys(LANGS)
    .map((l) => {
      const on = l === lang;
      return `<a href="${pageUrl(l, id)}" data-lang="${l}" hreflang="${LANGS[l].htmlLang}" lang="${LANGS[l].htmlLang}" class="lang-link px-2 py-1 ${on ? 'bg-panel2 text-pink' : 'text-mute hover:text-ink'}"${on ? ' aria-current="true"' : ''}>${l.toUpperCase()}</a>`;
    })
    .join('') +
  '</span>';

const files = readdirSync(path.join(root, 'site/pages')).filter((f) => f.endsWith('.html'));
const ptIds = files.filter((f) => !f.endsWith('.en.html')).map((f) => f.replace(/\.html$/, ''));

function build(lang) {
  const L = LANGS[lang];
  const head = read('site/head.html');
  const header = read(`site/header${lang === 'pt' ? '' : `.${lang}`}.html`);
  const footer = read(`site/footer${lang === 'pt' ? '' : `.${lang}`}.html`);
  const outDir = path.join(root, L.out);
  mkdirSync(outDir, { recursive: true });

  const ids = ptIds.filter((id) => lang === 'pt' || !PT_ONLY.has(id));
  for (const id of ids) {
    if (!existsSync(path.join(root, 'site/pages', id + L.suffix))) throw new Error(`Falta a pagina site/pages/${id}${L.suffix}`);
  }

  // Remove paginas antigas que nao existem mais em site/pages/.
  const wanted = new Set(ids.map((id) => `${id}.html`));
  for (const f of readdirSync(outDir)) {
    if (f.endsWith('.html') && !wanted.has(f)) rmSync(path.join(outDir, f));
  }

  for (const id of ids) {
    const src = read(`site/pages/${id}${L.suffix}`);
    const title = src.match(/<!--\s*title:\s*(.*?)\s*-->/)?.[1] ?? 'Lan House PS5';
    const script = src.match(/<!--\s*script:\s*(.*?)\s*-->/)?.[1];
    const main = src.replace(/<!--\s*(title|script):.*?-->\s*/g, '');
    const hdr =
      id === 'admin'
        ? header.replaceAll('{{NAV}}', '').replace('{{LANG_SWITCH}}', '').replace(/<div id="auth-area"[^>]*><\/div>/, '')
        : header.replaceAll('{{NAV}}', nav(lang, id)).replace('{{LANG_SWITCH}}', PT_ONLY.has(id) ? '' : langSwitch(lang, id));
    const html = [
      `<!DOCTYPE html>\n<html lang="${L.htmlLang}" class="dark">`,
      head.replace('{{TITLE}}', `Lan House PS5 // ${title}`),
      '<body class="font-sans text-ink antialiased min-h-screen flex flex-col">',
      hdr,
      `<main class="flex-1 w-full">${main}</main>`,
      footer,
      `<script src="/js/i18n/${lang}.js"></script>`,
      '<script src="/js/common.js"></script>',
      ...(script ? script.split(',').map((f) => f.trim()).map((f) => `<script src="${f.startsWith('/') ? f : '/js/' + f}"></script>`) : []),
      '</body></html>',
    ].join('\n');
    writeFileSync(path.join(outDir, `${id}.html`), html);
    console.log(`${L.out}/${id}.html`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const lang of Object.keys(LANGS)) build(lang);
}
