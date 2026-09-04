// Gerador do site público estático — lê o conteúdo do banco (Postgres/Neon) e escreve HTML
// pronto em dist/, pra ser publicado como Render Static Site (nunca "dorme", sempre disponível
// pros visitantes). O painel administrativo continua rodando normalmente à parte (server/index.js
// num serviço próprio); este script só cuida das páginas PÚBLICAS.
//
// Como rodar:
//   DATABASE_URL="postgres://..." PUBLIC_API_BASE="https://njfilmes-admin.onrender.com" node scripts/build-static.js
//
// PUBLIC_API_BASE deve apontar pro serviço que atende /api/curtir e /api/visualizar (o mesmo
// serviço do painel administrativo) — é assim que o botão de curtir e o contador de visualizações
// continuam funcionando mesmo com o site público sendo HTML estático, hospedado à parte.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DIST_DIR = path.join(ROOT, 'dist');

if (!process.env.DATABASE_URL) {
  console.error('Erro: defina DATABASE_URL (a connection string do Postgres/Neon) antes de rodar este script.');
  process.exit(1);
}
if (!process.env.PUBLIC_API_BASE) {
  console.warn(
    'Aviso: PUBLIC_API_BASE não definida — o botão de curtir e o contador de visualizações vão ' +
    'tentar chamar o próprio domínio do site estático, que não tem backend, e vão falhar ' +
    'silenciosamente (o número exibido simplesmente não sobe). Defina PUBLIC_API_BASE com a URL ' +
    'do serviço do painel administrativo antes de gerar o site final.'
  );
}

const { layout } = await import('../server/render.js');
const Pub = await import('../server/routes/public.js');
const { listCategories, listAllProjectsForAdmin, getSettings, listPhotosMissingDimensions, setPhotoDimensions } = await import(
  '../server/queries.js'
);
const { initSchema } = await import('../server/db.js');
await initSchema();

// 04/09/2026: fotos enviadas antes desta data não têm width/height salvos no banco (essas
// colunas são novas — ver server/db.js). A galeria rolante do projeto precisa dessas dimensões
// pra reservar o espaço exato de cada foto sem depender do navegador esperar a foto carregar
// (o que causava um bug de foto ficando cinza/invisível). Em vez de deixar essas fotos antigas
// sem essa informação pra sempre, medimos elas aqui (uma vez só) e gravamos no banco — assim o
// próximo build já não precisa medir de novo. Cada foto é tratada isoladamente (try/catch): se
// uma falhar (link fora do ar, etc.) o build inteiro não é interrompido por causa dela.
async function backfillPhotoDimensions() {
  const rows = await listPhotosMissingDimensions();
  if (!rows.length) return;
  console.log(`Medindo dimensões de ${rows.length} foto(s) enviada(s) antes desta atualização (sem tamanho salvo)...`);
  for (const row of rows) {
    try {
      let buffer;
      if (/^https?:\/\//.test(row.filename)) {
        const res = await fetch(row.filename);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buffer = Buffer.from(await res.arrayBuffer());
      } else {
        buffer = await fsp.readFile(path.join(PUBLIC_DIR, row.filename.replace(/^\//, '')));
      }
      const meta = await sharp(buffer).metadata();
      if (meta.width && meta.height) {
        await setPhotoDimensions(row.id, meta.width, meta.height);
      }
    } catch (err) {
      console.warn(`  ! não consegui medir a foto #${row.id} (${row.filename}): ${err.message}`);
    }
  }
}
await backfillPhotoDimensions();

// "Resposta falsa": os handlers de server/routes/public.js foram escritos pra um res.end(html)
// de verdade (http.ServerResponse). Aqui a gente só captura o texto que seria enviado, sem
// precisar reescrever nenhuma lógica de renderização — o HTML gerado é IDÊNTICO ao que o
// servidor dinâmico já produz hoje.
function makeFakeRes() {
  const state = { statusCode: 200, body: '' };
  return {
    get statusCode() { return state.statusCode; },
    set statusCode(v) { state.statusCode = v; },
    setHeader() {},
    getHeader() { return undefined; },
    end(chunk) { if (chunk) state.body += chunk; },
    _state: state,
  };
}

async function renderPage(handler, req) {
  const res = makeFakeRes();
  await handler(req, res);
  return { html: res._state.body, statusCode: res._state.statusCode };
}

async function writePage(relDir, html) {
  const dir = path.join(DIST_DIR, relDir);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'index.html'), html, 'utf8');
  console.log(`  ✓ /${relDir}`.replace(/\/$/, '') || '  ✓ /');
}

async function copyStaticAssets() {
  const toCopy = ['css', 'js', 'img', 'uploads'];
  for (const name of toCopy) {
    const src = path.join(PUBLIC_DIR, name);
    if (!fs.existsSync(src)) continue;
    await fsp.cp(src, path.join(DIST_DIR, name), { recursive: true });
  }
}

// Formata uma data como AAAA-MM-DD (aceito pelo padrão de sitemaps como <lastmod>) - null se a
// data vier vazia/inválida, pra essa URL simplesmente não levar <lastmod> nesse caso.
function sitemapLastmod(dateValue) {
  if (!dateValue) return null;
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
function sitemapUrlTag(loc, lastmod) {
  return lastmod ? `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>` : `  <url><loc>${loc}</loc></url>`;
}

async function buildSitemapAndRobots(categories, projects) {
  const base = process.env.SITE_URL || 'https://njfilmes.com.br';
  // <lastmod> adicionado em 04/09/2026: sem isso o Google não tinha sinal nenhum de quando uma
  // página mudou depois de editada no painel, o que podia atrasar o rastreamento de conteúdo
  // atualizado. Páginas fixas (home, portfólio, categorias) usam o horário desta publicação;
  // páginas de projeto usam a data real da última edição de cada um (updated_at).
  const buildTime = sitemapLastmod(new Date());
  const staticPaths = ['/', '/portfolio', '/sobre', '/servicos', '/contato'];
  const tags = [
    ...staticPaths.map((p) => sitemapUrlTag(`${base}${p}`, buildTime)),
    ...categories.map((c) => sitemapUrlTag(`${base}/portfolio/${c.slug}`, buildTime)),
    ...projects.map((p) => sitemapUrlTag(`${base}/portfolio/${p.slug}`, sitemapLastmod(p.updated_at))),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${tags.join('\n')}\n</urlset>`;
  await fsp.writeFile(path.join(DIST_DIR, 'sitemap.xml'), xml, 'utf8');

  const robots = `User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${base}/sitemap.xml\n`;
  await fsp.writeFile(path.join(DIST_DIR, 'robots.txt'), robots, 'utf8');
}

async function build404(settings, categories) {
  const html = layout({
    title: 'Página não encontrada',
    description: 'Conteúdo não encontrado.',
    path: '/404',
    settings,
    categories,
    noindex: true,
    content: `<section class="simple-hero text-center"><div class="container"><h1>404</h1><p>Essa página não existe.</p><a href="/" class="btn btn-solid">Voltar para a home</a></div></section>`,
  });
  await fsp.writeFile(path.join(DIST_DIR, '404.html'), html, 'utf8');
  console.log('  ✓ 404.html');
}

async function main() {
  console.log('Gerando site estático em dist/ ...\n');

  await fsp.rm(DIST_DIR, { recursive: true, force: true });
  await fsp.mkdir(DIST_DIR, { recursive: true });

  const settings = await getSettings();
  const categories = await listCategories();
  const allProjects = (await listAllProjectsForAdmin()).filter((p) => p.published);

  // Home
  {
    const { html } = await renderPage(Pub.homePage, {});
    await writePage('', html);
  }

  // Portfólio (índice)
  {
    const { html } = await renderPage(Pub.portfolioIndexPage, {});
    await writePage('portfolio', html);
  }

  // Uma página por categoria
  for (const cat of categories) {
    const { html, statusCode } = await renderPage(Pub.categoryOrProjectPage, { params: { slug: cat.slug } });
    if (statusCode !== 200) {
      console.warn(`  ! categoria "${cat.slug}" retornou status ${statusCode}, pulando.`);
      continue;
    }
    await writePage(`portfolio/${cat.slug}`, html);
  }

  // Uma página por projeto publicado
  for (const proj of allProjects) {
    const { html, statusCode } = await renderPage(Pub.categoryOrProjectPage, { params: { slug: proj.slug } });
    if (statusCode !== 200) {
      console.warn(`  ! projeto "${proj.slug}" retornou status ${statusCode}, pulando.`);
      continue;
    }
    await writePage(`portfolio/${proj.slug}`, html);
  }

  // Sobre / Serviços / Contato
  {
    const { html } = await renderPage(Pub.aboutPage, {});
    await writePage('sobre', html);
  }
  {
    const { html } = await renderPage(Pub.servicesPage, {});
    await writePage('servicos', html);
  }
  {
    const { html } = await renderPage(Pub.contactPage, {});
    await writePage('contato', html);
  }

  await build404(settings, categories);
  await buildSitemapAndRobots(categories, allProjects);
  await copyStaticAssets();

  console.log(`\nPronto! ${1 + 1 + categories.length + allProjects.length + 3} páginas geradas em dist/.`);
  console.log('Esse diretório é o que deve ser publicado no Render Static Site (Publish directory: dist).');
}

main().catch((err) => {
  console.error('Falha ao gerar o site estático:', err);
  process.exit(1);
});
