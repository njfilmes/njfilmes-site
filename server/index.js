// Servidor da NJFILMES — Node.js puro (http nativo), sem framework, sem build step.
// Banco de dados real (node:sqlite), upload real (sharp), autenticação real (scrypt + sessões).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBody } from './body.js';
import { getSessionIdFromReq, getSessionAdmin, findAdminByEmail, createAdminUser, hashPassword } from './auth.js';
import { db } from './db.js';
import * as Pub from './routes/public.js';
import * as Admin from './routes/admin.js';
import { listCategories, getSettings, listAllProjectsForAdmin } from './queries.js';
import { layout } from './render.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = process.env.PORT || 3000;

// Reset/criação de admin controlado por variável de ambiente (uso pontual, via painel do Render).
// Defina ADMIN_RESET_EMAIL e ADMIN_RESET_PASSWORD nas Environment Variables e faça o deploy;
// depois de logar, remova essas duas variáveis para não deixar a senha exposta em texto puro.
if (process.env.ADMIN_RESET_EMAIL && process.env.ADMIN_RESET_PASSWORD) {
  const email = process.env.ADMIN_RESET_EMAIL;
  const password = process.env.ADMIN_RESET_PASSWORD;
  const existing = findAdminByEmail(email);
  if (existing) {
    const { hash, salt } = hashPassword(password);
    db.prepare('UPDATE admin_users SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, existing.id);
    console.log(`[admin-reset] Senha atualizada para: ${email}`);
  } else {
    createAdminUser({ email, password, name: 'Administrador' });
    console.log(`[admin-reset] Administrador criado: ${email}`);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.statusCode = 404;
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    if (safePath.startsWith('/uploads/') || safePath.startsWith('/img/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    fs.createReadStream(filePath).pipe(res);
  });
}

function notFoundPublic(req, res) {
  const settings = getSettings();
  const categories = listCategories();
  res.statusCode = 404;
  res.end(
    layout({
      title: 'Página não encontrada',
      description: 'Conteúdo não encontrado.',
      path: req.url,
      settings,
      categories,
      noindex: true,
      content: `<section class="simple-hero text-center"><div class="container"><h1>404</h1><p>Essa página não existe.</p><a href="/" class="btn btn-solid">Voltar para a home</a></div></section>`,
    })
  );
}

function sitemapXml(req, res) {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  const base = process.env.SITE_URL || 'https://njfilmes.com.br';
  const staticPaths = ['/', '/portfolio', '/sobre', '/servicos', '/contato'];
  const categories = listCategories();
  const projects = listAllProjectsForAdmin().filter((p) => p.published);
  const urls = [
    ...staticPaths.map((p) => `${base}${p}`),
    ...categories.map((c) => `${base}/portfolio/${c.slug}`),
    ...projects.map((p) => `${base}/portfolio/${p.slug}`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${u}</loc></url>`)
    .join('\n')}\n</urlset>`;
  res.end(xml);
}

function robotsTxt(req, res) {
  const base = process.env.SITE_URL || 'https://njfilmes.com.br';
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(`User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${base}/sitemap.xml\n`);
}

async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  const method = req.method;
  let m;

  // Arquivos estáticos
  if (
    pathname.startsWith('/css/') ||
    pathname.startsWith('/js/') ||
    pathname.startsWith('/img/') ||
    pathname.startsWith('/uploads/') ||
    pathname === '/favicon.ico'
  ) {
    return serveStatic(req, res, pathname === '/favicon.ico' ? '/img/favicon.svg' : pathname);
  }

  if (pathname === '/sitemap.xml' && method === 'GET') return sitemapXml(req, res);
  if (pathname === '/robots.txt' && method === 'GET') return robotsTxt(req, res);

  // ---------------- Admin ----------------
  if (pathname.startsWith('/admin')) {
    const sessionId = getSessionIdFromReq(req);
    const admin = getSessionAdmin(sessionId);

    if (pathname === '/admin/setup') {
      if (method === 'GET') return Admin.setupPage(req, res);
      if (method === 'POST') return Admin.setupSubmit(req, res, await parseBody(req));
    }
    if (pathname === '/admin/login') {
      if (method === 'GET') return Admin.loginPage(req, res);
      if (method === 'POST') return Admin.loginSubmit(req, res, await parseBody(req));
    }
    if (pathname === '/admin/logout' && method === 'POST') {
      return Admin.logoutSubmit(req, res, sessionId);
    }
    // Recuperação de acesso self-service: protegida por uma chave secreta fixa
    // (variável de ambiente ADMIN_RECOVERY_KEY), pedido do usuário em 29/08/2026
    // para não precisar mais mexer nas Environment Variables do Render toda vez
    // que precisar trocar a senha do admin.
    if (pathname === '/admin/recuperar-senha') {
      if (method === 'GET') return Admin.recoverPage(req, res);
      if (method === 'POST') return Admin.recoverSubmit(req, res, await parseBody(req));
    }

    if (!admin) {
      res.statusCode = 302;
      res.setHeader('Location', '/admin/login');
      return res.end();
    }

    if (pathname === '/admin' && method === 'GET') return Admin.dashboardPage(req, res, admin);

    if (pathname === '/admin/categorias' && method === 'GET') return Admin.categoriesPage(req, res, admin);
    if (pathname === '/admin/categorias/criar' && method === 'POST') return Admin.categoryCreate(req, res, await parseBody(req));
    if ((m = pathname.match(/^\/admin\/categorias\/(\d+)\/editar$/)) && method === 'GET') return Admin.categoryEditPage(req, res, admin, Number(m[1]));
    if ((m = pathname.match(/^\/admin\/categorias\/(\d+)\/atualizar$/)) && method === 'POST') return Admin.categoryUpdate(req, res, await parseBody(req), Number(m[1]));
    if ((m = pathname.match(/^\/admin\/categorias\/(\d+)\/excluir$/)) && method === 'POST') return Admin.categoryDelete(req, res, Number(m[1]));
    if ((m = pathname.match(/^\/admin\/categorias\/(\d+)\/mover$/)) && method === 'POST') return Admin.categoryMove(req, res, await parseBody(req), Number(m[1]));

    if (pathname === '/admin/servicos' && method === 'GET') return Admin.servicesPage(req, res, admin);
    if (pathname === '/admin/servicos/criar' && method === 'POST') return Admin.serviceCreate(req, res, await parseBody(req));
    if ((m = pathname.match(/^\/admin\/servicos\/(\d+)\/editar$/)) && method === 'GET') return Admin.serviceEditPage(req, res, admin, Number(m[1]));
    if ((m = pathname.match(/^\/admin\/servicos\/(\d+)\/atualizar$/)) && method === 'POST') return Admin.serviceUpdate(req, res, await parseBody(req), Number(m[1]));
    if ((m = pathname.match(/^\/admin\/servicos\/(\d+)\/excluir$/)) && method === 'POST') return Admin.serviceDelete(req, res, Number(m[1]));
    if ((m = pathname.match(/^\/admin\/servicos\/(\d+)\/mover$/)) && method === 'POST') return Admin.serviceMove(req, res, await parseBody(req), Number(m[1]));

    if (pathname === '/admin/marcas' && method === 'GET') return Admin.brandsPage(req, res, admin);
    if (pathname === '/admin/marcas/criar' && method === 'POST') return Admin.brandCreate(req, res, await parseBody(req));
    if ((m = pathname.match(/^\/admin\/marcas\/(\d+)\/editar$/)) && method === 'GET') return Admin.brandEditPage(req, res, admin, Number(m[1]));
    if ((m = pathname.match(/^\/admin\/marcas\/(\d+)\/atualizar$/)) && method === 'POST') return Admin.brandUpdate(req, res, await parseBody(req), Number(m[1]));
    if ((m = pathname.match(/^\/admin\/marcas\/(\d+)\/excluir$/)) && method === 'POST') return Admin.brandDelete(req, res, Number(m[1]));
    if ((m = pathname.match(/^\/admin\/marcas\/(\d+)\/mover$/)) && method === 'POST') return Admin.brandMove(req, res, await parseBody(req), Number(m[1]));

    if (pathname === '/admin/pessoas' && method === 'GET') return Admin.peoplePage(req, res, admin);
    if (pathname === '/admin/pessoas/criar' && method === 'POST') return Admin.personCreate(req, res, await parseBody(req));
    if ((m = pathname.match(/^\/admin\/pessoas\/(\d+)\/editar$/)) && method === 'GET') return Admin.personEditPage(req, res, admin, Number(m[1]));
    if ((m = pathname.match(/^\/admin\/pessoas\/(\d+)\/atualizar$/)) && method === 'POST') return Admin.personUpdate(req, res, await parseBody(req), Number(m[1]));
    if ((m = pathname.match(/^\/admin\/pessoas\/(\d+)\/excluir$/)) && method === 'POST') return Admin.personDelete(req, res, Number(m[1]));
    if ((m = pathname.match(/^\/admin\/pessoas\/(\d+)\/mover$/)) && method === 'POST') return Admin.personMove(req, res, await parseBody(req), Number(m[1]));

    if (pathname === '/admin/depoimentos' && method === 'GET') return Admin.testimonialsPage(req, res, admin);
    if (pathname === '/admin/depoimentos/criar' && method === 'POST') return Admin.testimonialCreate(req, res, await parseBody(req));
    if ((m = pathname.match(/^\/admin\/depoimentos\/(\d+)\/editar$/)) && method === 'GET') return Admin.testimonialEditPage(req, res, admin, Number(m[1]));
    if ((m = pathname.match(/^\/admin\/depoimentos\/(\d+)\/atualizar$/)) && method === 'POST') return Admin.testimonialUpdate(req, res, await parseBody(req), Number(m[1]));
    if ((m = pathname.match(/^\/admin\/depoimentos\/(\d+)\/excluir$/)) && method === 'POST') return Admin.testimonialDelete(req, res, Number(m[1]));
    if ((m = pathname.match(/^\/admin\/depoimentos\/(\d+)\/mover$/)) && method === 'POST') return Admin.testimonialMove(req, res, await parseBody(req), Number(m[1]));

    if (pathname === '/admin/links' && method === 'GET') return Admin.linksPage(req, res, admin);
    if (pathname === '/admin/links/criar' && method === 'POST') return Admin.linkCreate(req, res, await parseBody(req));
    if ((m = pathname.match(/^\/admin\/links\/(\d+)\/excluir$/)) && method === 'POST') return Admin.linkDelete(req, res, Number(m[1]));
    if ((m = pathname.match(/^\/admin\/links\/(\d+)\/mover$/)) && method === 'POST') return Admin.linkMove(req, res, await parseBody(req), Number(m[1]));

    if (pathname === '/admin/bio' && method === 'GET') return Admin.bioPage(req, res, admin);
    if (pathname === '/admin/bio/atualizar' && method === 'POST') return Admin.bioUpdate(req, res, await parseBody(req));

    if (pathname === '/admin/configuracoes' && method === 'GET') return Admin.settingsPage(req, res, admin);
    if (pathname === '/admin/configuracoes/atualizar' && method === 'POST') return Admin.settingsUpdate(req, res, await parseBody(req));
    if (pathname === '/admin/conta/senha' && method === 'POST') return Admin.changePasswordSubmit(req, res, await parseBody(req), admin);

    if (pathname === '/admin/projetos' && method === 'GET') return Admin.projectsListPage(req, res, admin);
    if (pathname === '/admin/projetos/novo' && method === 'GET') return Admin.projectNewPage(req, res, admin);
    if (pathname === '/admin/projetos/criar' && method === 'POST') return Admin.projectCreate(req, res, await parseBody(req));

    if ((m = pathname.match(/^\/admin\/projetos\/(\d+)$/)) && method === 'GET') return Admin.projectEditPage(req, res, admin, Number(m[1]), 'info');
    if ((m = pathname.match(/^\/admin\/projetos\/(\d+)\/videos$/)) && method === 'GET') return Admin.projectEditPage(req, res, admin, Number(m[1]), 'videos');
    if ((m = pathname.match(/^\/admin\/projetos\/(\d+)\/fotos$/)) && method === 'GET') return Admin.projectEditPage(req, res, admin, Number(m[1]), 'fotos');
    if ((m = pathname.match(/^\/admin\/projetos\/(\d+)\/atualizar$/)) && method === 'POST') return Admin.projectUpdate(req, res, await parseBody(req), Number(m[1]));
    if ((m = pathname.match(/^\/admin\/projetos\/(\d+)\/excluir$/)) && method === 'POST') return Admin.projectDelete(req, res, Number(m[1]));

    if ((m = pathname.match(/^\/admin\/projetos\/(\d+)\/videos\/criar$/)) && method === 'POST') return Admin.projectVideoCreate(req, res, await parseBody(req), Number(m[1]));
    if ((m = pathname.match(/^\/admin\/projetos\/(\d+)\/videos\/(\d+)\/excluir$/)) && method === 'POST') return Admin.projectVideoDelete(req, res, Number(m[1]), Number(m[2]));

    if ((m = pathname.match(/^\/admin\/projetos\/(\d+)\/photos\/upload$/)) && method === 'POST') return Admin.projectPhotosUpload(req, res, await parseBody(req), Number(m[1]));
    if ((m = pathname.match(/^\/admin\/projetos\/(\d+)\/fotos\/(\d+)\/excluir$/)) && method === 'POST') return Admin.projectPhotoDelete(req, res, Number(m[1]), Number(m[2]));
    if ((m = pathname.match(/^\/admin\/projetos\/(\d+)\/fotos\/(\d+)\/capa$/)) && method === 'POST') return Admin.projectPhotoSetCover(req, res, Number(m[1]), Number(m[2]));
    if ((m = pathname.match(/^\/admin\/projetos\/(\d+)\/fotos\/(\d+)\/legenda$/)) && method === 'POST') return Admin.projectPhotoCaption(req, res, await parseBody(req), Number(m[1]), Number(m[2]));
    if ((m = pathname.match(/^\/admin\/projetos\/(\d+)\/fotos\/(\d+)\/mover$/)) && method === 'POST') return Admin.projectPhotoMove(req, res, await parseBody(req), Number(m[1]), Number(m[2]));

    res.statusCode = 404;
    return res.end('Admin: página não encontrada.');
  }

  // ---------------- Site público ----------------
  if (pathname === '/' && method === 'GET') return Pub.homePage(req, res);
  if (pathname === '/portfolio' && method === 'GET') return Pub.portfolioIndexPage(req, res);
  if ((m = pathname.match(/^\/portfolio\/([a-z0-9-]+)$/)) && method === 'GET') {
    req.params = { slug: m[1] };
    return Pub.categoryOrProjectPage(req, res);
  }
  if (pathname === '/sobre' && method === 'GET') return Pub.aboutPage(req, res);
  if (pathname === '/servicos' && method === 'GET') return Pub.servicesPage(req, res);
  if (pathname === '/contato' && method === 'GET') return Pub.contactPage(req, res);

  return notFoundPublic(req, res);
}

const server = http.createServer((req, res) => {
  router(req, res).catch((err) => {
    console.error('Erro no servidor:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('Erro interno do servidor.');
    }
  });
});

server.listen(PORT, () => {
  console.log(`NJFILMES rodando em http://localhost:${PORT}`);
});
