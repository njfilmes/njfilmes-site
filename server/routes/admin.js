import crypto from 'node:crypto';
import { adminLayout, loginLayout, field, checkboxField, selectField } from '../adminRender.js';
import { escapeHtml } from '../util.js';
import { parseVideoUrl, videoEmbedHtml, uniqueSlug, formatDatePtBr, formatDateTimePtBr } from '../util.js';
import { query, queryOne } from '../db.js';
import {
  createAdminUser,
  findAdminByEmail,
  verifyPassword,
  hashPassword,
  createSession,
  destroySession,
  countAdmins,
  setSessionCookie,
  clearSessionCookie,
} from '../auth.js';
import { saveProjectPhoto, saveMiscImage, deletePhotoFiles } from '../upload.js';
import * as Q from '../queries.js';

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

// Compara a chave de recuperação sem vazar, pelo tempo de resposta, quantos caracteres bateram
// certo — mesma ideia do verifyPassword em auth.js, só que pra string simples (não hash).
function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA); // gasta um tempo parecido, não retorna cedo demais
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function withFlash(res, type, message) {
  // Flash simples via query string (funciona sem sessão extra de flash messages)
  return `?flash=${type}:${encodeURIComponent(message)}`;
}

function readFlash(req) {
  const url = new URL(req.url, 'http://x');
  const raw = url.searchParams.get('flash');
  if (!raw) return null;
  const idx = raw.indexOf(':');
  // O "type" vira classe CSS (admin-flash-${type}) sem passar por escapeHtml no layout, então
  // é preciso restringir a um valor fixo conhecido aqui — senão alguém poderia montar um link
  // tipo /admin/recuperar-senha?flash=x"><script>...</script>:x e injetar HTML/JS na página
  // (funciona até sem estar logado, porque a recuperação de senha é pública). Descoberto e
  // corrigido em 02/09/2026 numa varredura de segurança.
  const rawType = raw.slice(0, idx);
  const type = rawType === 'success' ? 'success' : 'error';
  return { type, message: decodeURIComponent(raw.slice(idx + 1)) };
}

async function maxSortOrder(table, whereCol = null, whereVal = null) {
  const row = whereCol
    ? await queryOne(`SELECT COALESCE(MAX(sort_order),0) as m FROM ${table} WHERE ${whereCol} = $1`, [whereVal])
    : await queryOne(`SELECT COALESCE(MAX(sort_order),0) as m FROM ${table}`);
  return Number(row.m);
}

// ---------------- Setup / Login ----------------

export async function setupPage(req, res) {
  if ((await countAdmins()) > 0) return redirect(res, '/admin/login');
  res.end(
    loginLayout({
      title: 'Criar administrador',
      content: `
      <h1>Criar o primeiro administrador</h1>
      <p class="sub">Esta tela só aparece quando ainda não existe nenhum administrador cadastrado.</p>
      <form method="post" action="/admin/setup">
        ${field({ label: 'Seu nome', name: 'name', required: true })}
        ${field({ label: 'E-mail', name: 'email', type: 'email', required: true })}
        ${field({ label: 'Senha', name: 'password', type: 'password', required: true, help: 'Use pelo menos 8 caracteres.' })}
        <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Criar administrador</button></div>
      </form>`,
    })
  );
}

export async function setupSubmit(req, res, body) {
  if ((await countAdmins()) > 0) return redirect(res, '/admin/login');
  const { name, email, password } = body;
  if (!email || !password || String(password).length < 6) {
    return res.end(
      loginLayout({
        title: 'Criar administrador',
        content: `<h1>Criar o primeiro administrador</h1><p class="sub" style="color:#d0503a;">Preencha e-mail e uma senha com pelo menos 6 caracteres.</p>
        <form method="post" action="/admin/setup">
          ${field({ label: 'Seu nome', name: 'name', value: name, required: true })}
          ${field({ label: 'E-mail', name: 'email', type: 'email', value: email, required: true })}
          ${field({ label: 'Senha', name: 'password', type: 'password', required: true })}
          <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Criar administrador</button></div>
        </form>`,
      })
    );
  }
  const id = await createAdminUser({ email, password, name });
  const session = await createSession(id);
  setSessionCookie(res, session.id, session.expires);
  redirect(res, '/admin');
}

export async function loginPage(req, res) {
  if ((await countAdmins()) === 0) return redirect(res, '/admin/setup');
  const error = new URL(req.url, 'http://x').searchParams.get('erro');
  res.end(
    loginLayout({
      title: 'Entrar',
      content: `
      <h1>Painel administrativo</h1>
      <p class="sub">Entre com seu e-mail e senha para gerenciar o site.</p>
      ${error ? `<div class="admin-flash admin-flash-error" style="margin:0 0 18px;">E-mail ou senha inválidos.</div>` : ''}
      <form method="post" action="/admin/login">
        ${field({ label: 'E-mail', name: 'email', type: 'email', required: true })}
        ${field({ label: 'Senha', name: 'password', type: 'password', required: true })}
        <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Entrar</button></div>
      </form>`,
    })
  );
}

export async function loginSubmit(req, res, body) {
  const { email, password } = body;
  const admin = await findAdminByEmail(email || '');
  if (!admin || !verifyPassword(password || '', admin.password_hash, admin.salt)) {
    return redirect(res, '/admin/login?erro=1');
  }
  const session = await createSession(admin.id);
  setSessionCookie(res, session.id, session.expires);
  redirect(res, '/admin');
}

export async function logoutSubmit(req, res, sessionId) {
  await destroySession(sessionId);
  clearSessionCookie(res);
  redirect(res, '/admin/login');
}

// ---------------- Dashboard ----------------

export async function dashboardPage(req, res, admin) {
  const flash = readFlash(req);
  const totalProjects = await Q.countProjects();
  const published = await Q.countProjects({ onlyPublished: true });
  const draft = totalProjects - published;
  const totalPhotos = await Q.countPhotos();
  const totalCats = await Q.countCategories();
  const recentProjects = (await Q.listAllProjectsForAdmin()).slice(0, 6);

  const content = `
  <div class="stat-cards">
    <div class="stat-card"><b>${totalProjects}</b><span>Projetos</span></div>
    <div class="stat-card"><b>${published}</b><span>Publicados</span></div>
    <div class="stat-card"><b>${draft}</b><span>Rascunhos</span></div>
    <div class="stat-card"><b>${totalPhotos}</b><span>Fotos</span></div>
    <div class="stat-card"><b>${totalCats}</b><span>Categorias</span></div>
  </div>
  <div class="panel">
    <h2>Atalhos</h2>
    <div class="shortcut-grid">
      <a class="shortcut-card" href="/admin/projetos/novo">+ Novo projeto</a>
      <a class="shortcut-card" href="/admin/categorias">+ Nova categoria</a>
      <a class="shortcut-card" href="/admin/servicos">Editar serviços</a>
      <a class="shortcut-card" href="/admin/bio">Editar biografia</a>
      <a class="shortcut-card" href="/admin/configuracoes">Configurar WhatsApp</a>
      <a class="shortcut-card" href="/admin/links">Links externos</a>
      <a class="shortcut-card" href="/admin/menu">Editar menu do site</a>
    </div>
  </div>
  <div class="panel">
    <h2>Últimos projetos</h2>
    ${renderProjectsTable(recentProjects)}
  </div>`;

  res.end(adminLayout({ title: 'Dashboard', activePath: '/admin', admin, content, flash }));
}

// ---------------- Categorias ----------------

export async function categoriesPage(req, res, admin) {
  const flash = readFlash(req);
  const categories = await Q.listCategories();
  const rows = categories
    .map(
      (c, i) => `<tr>
      <td>${escapeHtml(c.name)}</td>
      <td class="muted">/portfolio/${escapeHtml(c.slug)}</td>
      <td>
        <form method="post" action="/admin/categorias/${c.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="up"><button class="btn-a btn-a-sm" ${i === 0 ? 'disabled' : ''}>↑</button></form>
        <form method="post" action="/admin/categorias/${c.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="down"><button class="btn-a btn-a-sm" ${i === categories.length - 1 ? 'disabled' : ''}>↓</button></form>
      </td>
      <td class="row-actions">
        <a class="btn-a btn-a-sm" href="/admin/categorias/${c.id}/editar">Editar</a>
        <form method="post" action="/admin/categorias/${c.id}/excluir" data-confirm="Excluir a categoria &quot;${escapeHtml(c.name)}&quot;? Os projetos dela ficam sem categoria."><button class="btn-a btn-a-sm btn-a-danger" type="submit">Excluir</button></form>
      </td>
    </tr>`
    )
    .join('');

  const content = `
  <div class="panel">
    <h2>Nova categoria</h2>
    <form method="post" action="/admin/categorias/criar">
      <div class="form-row">
        ${field({ label: 'Nome da categoria', name: 'name', placeholder: 'Ex: Casamentos', required: true })}
      </div>
      <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Adicionar categoria</button></div>
    </form>
  </div>
  <div class="panel">
    <div class="panel-head"><h2>Categorias (${categories.length})</h2></div>
    ${categories.length ? `<table class="admin-table"><thead><tr><th>Nome</th><th>URL</th><th>Ordem</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="empty-hint">Nenhuma categoria ainda. Crie a primeira acima — ela aparece automaticamente no menu e nos filtros do portfólio.</p>'}
  </div>`;

  res.end(adminLayout({ title: 'Categorias', activePath: '/admin/categorias', admin, content, flash }));
}

export async function categoryEditPage(req, res, admin, id) {
  const category = await Q.getCategory(id);
  if (!category) return redirect(res, '/admin/categorias');
  const content = `
  <div class="panel">
    <h2>Editar categoria</h2>
    <form method="post" action="/admin/categorias/${category.id}/atualizar">
      ${field({ label: 'Nome', name: 'name', value: category.name, required: true })}
      ${field({ label: 'URL (slug)', name: 'slug', value: category.slug, help: 'Usado no endereço: /portfolio/' + category.slug })}
      <div class="form-actions">
        <button class="btn-a btn-a-primary" type="submit">Salvar</button>
        <a class="btn-a" href="/admin/categorias">Cancelar</a>
      </div>
    </form>
  </div>`;
  res.end(adminLayout({ title: 'Editar categoria', activePath: '/admin/categorias', admin, content }));
}

export async function categoryCreate(req, res, body) {
  const name = (body.name || '').trim();
  if (!name) return redirect(res, '/admin/categorias');
  const slug = await uniqueSlug(['categories', 'projects'], name);
  const maxOrder = await maxSortOrder('categories');
  await Q.createCategory({ name, slug, sort_order: maxOrder + 1 });
  redirect(res, '/admin/categorias' + withFlash(res, 'success', 'Categoria criada.'));
}

export async function categoryUpdate(req, res, body, id) {
  const category = await Q.getCategory(id);
  if (!category) return redirect(res, '/admin/categorias');
  const name = (body.name || category.name).trim();
  const slug = await uniqueSlug(['categories', 'projects'], (body.slug || '').trim() || name, id);
  await Q.updateCategory(id, { name, slug, sort_order: category.sort_order });
  redirect(res, '/admin/categorias');
}

export async function categoryDelete(req, res, id) {
  await Q.deleteCategory(id);
  redirect(res, '/admin/categorias' + withFlash(res, 'success', 'Categoria excluída.'));
}

export async function categoryMove(req, res, body, id) {
  const cats = await Q.listCategories();
  const idx = cats.findIndex((c) => c.id === id);
  if (idx === -1) return redirect(res, '/admin/categorias');
  const swapWith = body.dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= cats.length) return redirect(res, '/admin/categorias');
  const a = cats[idx];
  const b = cats[swapWith];
  await query('UPDATE categories SET sort_order = $1 WHERE id = $2', [b.sort_order, a.id]);
  await query('UPDATE categories SET sort_order = $1 WHERE id = $2', [a.sort_order, b.id]);
  redirect(res, '/admin/categorias');
}

// ---------------- Serviços ----------------

export async function servicesPage(req, res, admin) {
  const flash = readFlash(req);
  const services = await Q.listServices();
  const rows = services
    .map(
      (s, i) => `<tr>
      <td><img class="thumb-sm" src="${escapeHtml(s.image || '/img/placeholder.svg')}" alt=""></td>
      <td>${escapeHtml(s.title)}</td>
      <td>${s.published ? '<span class="tag tag-published">Publicado</span>' : '<span class="tag tag-draft">Rascunho</span>'}</td>
      <td>
        <form method="post" action="/admin/servicos/${s.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="up"><button class="btn-a btn-a-sm" ${i === 0 ? 'disabled' : ''}>↑</button></form>
        <form method="post" action="/admin/servicos/${s.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="down"><button class="btn-a btn-a-sm" ${i === services.length - 1 ? 'disabled' : ''}>↓</button></form>
      </td>
      <td class="row-actions">
        <a class="btn-a btn-a-sm" href="/admin/servicos/${s.id}/editar">Editar</a>
        <form method="post" action="/admin/servicos/${s.id}/excluir" data-confirm="Excluir o serviço &quot;${escapeHtml(s.title)}&quot;?"><button class="btn-a btn-a-sm btn-a-danger" type="submit">Excluir</button></form>
      </td>
    </tr>`
    )
    .join('');

  const content = `
  <div class="panel">
    <h2>Novo serviço</h2>
    ${serviceForm({ action: '/admin/servicos/criar' })}
  </div>
  <div class="panel">
    <h2>Serviços (${services.length})</h2>
    ${services.length ? `<table class="admin-table"><thead><tr><th>Imagem</th><th>Título</th><th>Status</th><th>Ordem</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="empty-hint">Nenhum serviço cadastrado ainda.</p>'}
  </div>`;
  res.end(adminLayout({ title: 'Serviços', activePath: '/admin/servicos', admin, content, flash }));
}

function serviceForm({ action, service = {} }) {
  return `<form method="post" action="${action}">
    ${field({ label: 'Título', name: 'title', value: service.title, required: true })}
    ${field({ label: 'Descrição', name: 'description', value: service.description, textarea: true })}
    <div class="form-field" data-single-upload>
      <label>Imagem (opcional)</label>
      <input type="file" accept="image/*">
      <input type="hidden" name="image_data">
      ${service.image ? `<img data-preview src="${escapeHtml(service.image)}" style="max-width:160px;border-radius:6px;margin-top:8px;display:block;">` : `<img data-preview src="" style="max-width:160px;border-radius:6px;margin-top:8px;display:none;">`}
      <input type="hidden" name="image_existing" value="${escapeHtml(service.image || '')}">
    </div>
    ${checkboxField({ label: 'Publicado (visível no site)', name: 'published', checked: service.published !== 0 })}
    <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Salvar</button></div>
  </form>`;
}

export async function serviceEditPage(req, res, admin, id) {
  const service = await Q.getService(id);
  if (!service) return redirect(res, '/admin/servicos');
  const content = `<div class="panel"><h2>Editar serviço</h2>${serviceForm({ action: `/admin/servicos/${id}/atualizar`, service })}</div>`;
  res.end(adminLayout({ title: 'Editar serviço', activePath: '/admin/servicos', admin, content }));
}

export async function serviceCreate(req, res, body) {
  let image = '';
  if (body.image_data) {
    try { image = await saveMiscImage(body.image_data); } catch { /* ignora imagem inválida */ }
  }
  const maxOrder = await maxSortOrder('services');
  await Q.createService({ title: body.title, description: body.description, image, sort_order: maxOrder + 1, published: !!body.published });
  redirect(res, '/admin/servicos' + withFlash(res, 'success', 'Serviço criado.'));
}

export async function serviceUpdate(req, res, body, id) {
  const service = await Q.getService(id);
  if (!service) return redirect(res, '/admin/servicos');
  let image = body.image_existing || service.image;
  if (body.image_data) {
    try { image = await saveMiscImage(body.image_data); } catch { /* mantém imagem anterior */ }
  }
  await Q.updateService(id, { title: body.title, description: body.description, image, sort_order: service.sort_order, published: !!body.published });
  redirect(res, '/admin/servicos');
}

export async function serviceDelete(req, res, id) {
  await Q.deleteService(id);
  redirect(res, '/admin/servicos' + withFlash(res, 'success', 'Serviço excluído.'));
}

export async function serviceMove(req, res, body, id) {
  const items = await Q.listServices();
  const idx = items.findIndex((s) => s.id === id);
  if (idx === -1) return redirect(res, '/admin/servicos');
  const swapWith = body.dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= items.length) return redirect(res, '/admin/servicos');
  const a = items[idx], b = items[swapWith];
  await query('UPDATE services SET sort_order = $1 WHERE id = $2', [b.sort_order, a.id]);
  await query('UPDATE services SET sort_order = $1 WHERE id = $2', [a.sort_order, b.id]);
  redirect(res, '/admin/servicos');
}

// ---------------- Marcas (clientes) ----------------

export async function brandsPage(req, res, admin) {
  const flash = readFlash(req);
  const brands = await Q.listBrands();
  const rows = brands
    .map(
      (b, i) => `<tr>
      <td><img class="thumb-sm" style="background:#fff;object-fit:contain;" src="${escapeHtml(b.logo)}" alt=""></td>
      <td>${escapeHtml(b.name)}</td>
      <td>
        <form method="post" action="/admin/marcas/${b.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="up"><button class="btn-a btn-a-sm" ${i === 0 ? 'disabled' : ''}>↑</button></form>
        <form method="post" action="/admin/marcas/${b.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="down"><button class="btn-a btn-a-sm" ${i === brands.length - 1 ? 'disabled' : ''}>↓</button></form>
      </td>
      <td class="row-actions">
        <a class="btn-a btn-a-sm" href="/admin/marcas/${b.id}/editar">Editar</a>
        <form method="post" action="/admin/marcas/${b.id}/excluir" data-confirm="Excluir a marca &quot;${escapeHtml(b.name)}&quot;?"><button class="btn-a btn-a-sm btn-a-danger" type="submit">Excluir</button></form>
      </td>
    </tr>`
    )
    .join('');
  const content = `
  <div class="panel">
    <h2>Nova marca / cliente</h2>
    <p class="muted" style="margin-top:-8px;">Aparece na Home como uma faixa de logos de clientes que você já atendeu.</p>
    ${brandForm({ action: '/admin/marcas/criar' })}
  </div>
  <div class="panel">
    <h2>Marcas (${brands.length})</h2>
    ${brands.length ? `<table class="admin-table"><thead><tr><th>Logo</th><th>Nome</th><th>Ordem</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="empty-hint">Nenhuma marca cadastrada ainda.</p>'}
  </div>`;
  res.end(adminLayout({ title: 'Marcas', activePath: '/admin/marcas', admin, content, flash }));
}

function brandForm({ action, brand = {} }) {
  return `<form method="post" action="${action}">
    ${field({ label: 'Nome da marca', name: 'name', value: brand.name, required: true, placeholder: 'Ex: Assaí Atacadista' })}
    ${field({ label: 'Link do site da marca (opcional)', name: 'url', value: brand.url, type: 'url' })}
    <div class="form-field" data-single-upload>
      <label>Logo ${brand.logo ? '' : '(obrigatório)'}</label>
      <input type="file" accept="image/*">
      <input type="hidden" name="logo_data">
      <input type="hidden" name="logo_existing" value="${escapeHtml(brand.logo || '')}">
      <img data-preview src="${escapeHtml(brand.logo || '')}" style="max-width:160px;border-radius:6px;margin-top:8px;background:#fff;padding:8px;display:${brand.logo ? 'block' : 'none'};">
      <small>Use uma imagem com fundo branco ou transparente, de preferência em PNG.</small>
    </div>
    <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Salvar</button></div>
  </form>`;
}

export async function brandEditPage(req, res, admin, id) {
  const brand = await Q.getBrand(id);
  if (!brand) return redirect(res, '/admin/marcas');
  const content = `<div class="panel"><h2>Editar marca</h2>${brandForm({ action: `/admin/marcas/${id}/atualizar`, brand })}</div>`;
  res.end(adminLayout({ title: 'Editar marca', activePath: '/admin/marcas', admin, content }));
}

export async function brandCreate(req, res, body) {
  if (!body.logo_data) return redirect(res, '/admin/marcas' + withFlash(res, 'error', 'Envie uma imagem de logo.'));
  let logo;
  try { logo = await saveMiscImage(body.logo_data); } catch (e) { return redirect(res, '/admin/marcas' + withFlash(res, 'error', e.message)); }
  const maxOrder = await maxSortOrder('brands');
  await Q.createBrand({ name: body.name, logo, url: body.url, sort_order: maxOrder + 1 });
  redirect(res, '/admin/marcas' + withFlash(res, 'success', 'Marca adicionada.'));
}

export async function brandUpdate(req, res, body, id) {
  const brand = await Q.getBrand(id);
  if (!brand) return redirect(res, '/admin/marcas');
  let logo = body.logo_existing || brand.logo;
  if (body.logo_data) {
    try { logo = await saveMiscImage(body.logo_data); } catch { /* mantém logo anterior */ }
  }
  await Q.updateBrand(id, { name: body.name, logo, url: body.url, sort_order: brand.sort_order });
  redirect(res, '/admin/marcas');
}

export async function brandDelete(req, res, id) {
  await Q.deleteBrand(id);
  redirect(res, '/admin/marcas' + withFlash(res, 'success', 'Marca excluída.'));
}

export async function brandMove(req, res, body, id) {
  const items = await Q.listBrands();
  const idx = items.findIndex((b) => b.id === id);
  if (idx === -1) return redirect(res, '/admin/marcas');
  const swapWith = body.dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= items.length) return redirect(res, '/admin/marcas');
  const a = items[idx], b = items[swapWith];
  await query('UPDATE brands SET sort_order = $1 WHERE id = $2', [b.sort_order, a.id]);
  await query('UPDATE brands SET sort_order = $1 WHERE id = $2', [a.sort_order, b.id]);
  redirect(res, '/admin/marcas');
}

// ---------------- Pessoas ----------------

export async function peoplePage(req, res, admin) {
  const flash = readFlash(req);
  const people = await Q.listPeople();
  const rows = people
    .map(
      (p, i) => `<tr>
      <td><img class="thumb-sm" src="${escapeHtml(p.photo)}" alt=""></td>
      <td>${escapeHtml(p.name)}</td>
      <td class="muted">${escapeHtml(p.role || '—')}</td>
      <td>
        <form method="post" action="/admin/pessoas/${p.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="up"><button class="btn-a btn-a-sm" ${i === 0 ? 'disabled' : ''}>↑</button></form>
        <form method="post" action="/admin/pessoas/${p.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="down"><button class="btn-a btn-a-sm" ${i === people.length - 1 ? 'disabled' : ''}>↓</button></form>
      </td>
      <td class="row-actions">
        <a class="btn-a btn-a-sm" href="/admin/pessoas/${p.id}/editar">Editar</a>
        <form method="post" action="/admin/pessoas/${p.id}/excluir" data-confirm="Excluir &quot;${escapeHtml(p.name)}&quot;?"><button class="btn-a btn-a-sm btn-a-danger" type="submit">Excluir</button></form>
      </td>
    </tr>`
    )
    .join('');
  const content = `
  <div class="panel">
    <h2>Nova pessoa</h2>
    <p class="muted" style="margin-top:-8px;">Artistas, apresentadores ou clientes que você já fotografou/filmou — aparece na página Sobre, separado dos projetos.</p>
    ${personForm({ action: '/admin/pessoas/criar' })}
  </div>
  <div class="panel">
    <h2>Pessoas (${people.length})</h2>
    ${people.length ? `<table class="admin-table"><thead><tr><th>Foto</th><th>Nome</th><th>Função</th><th>Ordem</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="empty-hint">Nenhuma pessoa cadastrada ainda.</p>'}
  </div>`;
  res.end(adminLayout({ title: 'Pessoas', activePath: '/admin/pessoas', admin, content, flash }));
}

function personForm({ action, person = {} }) {
  return `<form method="post" action="${action}">
    ${field({ label: 'Nome', name: 'name', value: person.name, required: true, placeholder: 'Ex: Fulano de Tal' })}
    ${field({ label: 'Função / contexto (opcional)', name: 'role', value: person.role, placeholder: 'Ex: Cantor · Apresentadora de TV · Ensaio fotográfico' })}
    <div class="form-field" data-single-upload>
      <label>Foto ${person.photo ? '' : '(obrigatória)'}</label>
      <input type="file" accept="image/*">
      <input type="hidden" name="photo_data">
      <input type="hidden" name="photo_existing" value="${escapeHtml(person.photo || '')}">
      <img data-preview src="${escapeHtml(person.photo || '')}" style="max-width:160px;border-radius:6px;margin-top:8px;display:${person.photo ? 'block' : 'none'};">
    </div>
    <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Salvar</button></div>
  </form>`;
}

export async function personEditPage(req, res, admin, id) {
  const person = await Q.getPerson(id);
  if (!person) return redirect(res, '/admin/pessoas');
  const content = `<div class="panel"><h2>Editar pessoa</h2>${personForm({ action: `/admin/pessoas/${id}/atualizar`, person })}</div>`;
  res.end(adminLayout({ title: 'Editar pessoa', activePath: '/admin/pessoas', admin, content }));
}

export async function personCreate(req, res, body) {
  if (!body.photo_data) return redirect(res, '/admin/pessoas' + withFlash(res, 'error', 'Envie uma foto.'));
  let photo;
  try { photo = await saveMiscImage(body.photo_data); } catch (e) { return redirect(res, '/admin/pessoas' + withFlash(res, 'error', e.message)); }
  const maxOrder = await maxSortOrder('people');
  await Q.createPerson({ name: body.name, role: body.role, photo, sort_order: maxOrder + 1 });
  redirect(res, '/admin/pessoas' + withFlash(res, 'success', 'Pessoa adicionada.'));
}

export async function personUpdate(req, res, body, id) {
  const person = await Q.getPerson(id);
  if (!person) return redirect(res, '/admin/pessoas');
  let photo = body.photo_existing || person.photo;
  if (body.photo_data) {
    try { photo = await saveMiscImage(body.photo_data); } catch { /* mantém foto anterior */ }
  }
  await Q.updatePerson(id, { name: body.name, role: body.role, photo, sort_order: person.sort_order });
  redirect(res, '/admin/pessoas');
}

export async function personDelete(req, res, id) {
  await Q.deletePerson(id);
  redirect(res, '/admin/pessoas' + withFlash(res, 'success', 'Pessoa excluída.'));
}

export async function personMove(req, res, body, id) {
  const items = await Q.listPeople();
  const idx = items.findIndex((p) => p.id === id);
  if (idx === -1) return redirect(res, '/admin/pessoas');
  const swapWith = body.dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= items.length) return redirect(res, '/admin/pessoas');
  const a = items[idx], b = items[swapWith];
  await query('UPDATE people SET sort_order = $1 WHERE id = $2', [b.sort_order, a.id]);
  await query('UPDATE people SET sort_order = $1 WHERE id = $2', [a.sort_order, b.id]);
  redirect(res, '/admin/pessoas');
}

// ---------------- Depoimentos (feedback de clientes em vídeo) ----------------

export async function testimonialsPage(req, res, admin) {
  const flash = readFlash(req);
  const testimonials = await Q.listTestimonials();
  const rows = testimonials
    .map(
      (t, i) => `<tr>
      <td>${escapeHtml(t.client_name)}</td>
      <td class="muted">${escapeHtml(t.role || '—')}</td>
      <td class="muted" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(t.video_url)}</td>
      <td>
        <form method="post" action="/admin/depoimentos/${t.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="up"><button class="btn-a btn-a-sm" ${i === 0 ? 'disabled' : ''}>↑</button></form>
        <form method="post" action="/admin/depoimentos/${t.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="down"><button class="btn-a btn-a-sm" ${i === testimonials.length - 1 ? 'disabled' : ''}>↓</button></form>
      </td>
      <td class="row-actions">
        <a class="btn-a btn-a-sm" href="/admin/depoimentos/${t.id}/editar">Editar</a>
        <form method="post" action="/admin/depoimentos/${t.id}/excluir" data-confirm="Excluir o depoimento de &quot;${escapeHtml(t.client_name)}&quot;?"><button class="btn-a btn-a-sm btn-a-danger" type="submit">Excluir</button></form>
      </td>
    </tr>`
    )
    .join('');
  const content = `
  <div class="panel">
    <h2>Novo depoimento</h2>
    <p class="muted" style="margin-top:-8px;">Vídeos de feedback de clientes. Cole o link do YouTube, Vimeo ou Mega (link de compartilhamento do arquivo) — o site identifica e incorpora automaticamente. Aparece na Home, numa faixa que a pessoa rola para ver um depoimento após o outro.</p>
    ${testimonialForm({ action: '/admin/depoimentos/criar' })}
  </div>
  <div class="panel">
    <h2>Depoimentos (${testimonials.length})</h2>
    ${testimonials.length ? `<table class="admin-table"><thead><tr><th>Cliente</th><th>Contexto</th><th>Vídeo</th><th>Ordem</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="empty-hint">Nenhum depoimento cadastrado ainda.</p>'}
  </div>`;
  res.end(adminLayout({ title: 'Depoimentos', activePath: '/admin/depoimentos', admin, content, flash }));
}

function testimonialForm({ action, testimonial = {} }) {
  return `<form method="post" action="${action}">
    ${field({ label: 'Nome do cliente', name: 'client_name', value: testimonial.client_name, required: true, placeholder: 'Ex: Maria Silva' })}
    ${field({ label: 'Contexto (opcional)', name: 'role', value: testimonial.role, placeholder: 'Ex: Casamento · Evento corporativo · Ensaio' })}
    ${field({ label: 'Link do vídeo (YouTube, Vimeo ou Mega)', name: 'video_url', value: testimonial.video_url, required: true, placeholder: 'https://...' })}
    <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Salvar</button></div>
  </form>`;
}

export async function testimonialEditPage(req, res, admin, id) {
  const testimonial = await Q.getTestimonial(id);
  if (!testimonial) return redirect(res, '/admin/depoimentos');
  const content = `<div class="panel"><h2>Editar depoimento</h2>${testimonialForm({ action: `/admin/depoimentos/${id}/atualizar`, testimonial })}</div>`;
  res.end(adminLayout({ title: 'Editar depoimento', activePath: '/admin/depoimentos', admin, content }));
}

export async function testimonialCreate(req, res, body) {
  const clientName = (body.client_name || '').trim();
  if (!clientName) return redirect(res, '/admin/depoimentos' + withFlash(res, 'error', 'Informe o nome do cliente.'));
  const parsed = parseVideoUrl(body.video_url);
  if (!parsed) return redirect(res, '/admin/depoimentos' + withFlash(res, 'error', 'Link de vídeo inválido.'));
  const maxOrder = await maxSortOrder('testimonials');
  await Q.createTestimonial({
    client_name: clientName,
    role: body.role || '',
    provider: parsed.provider,
    video_id: parsed.videoId,
    video_url: parsed.url,
    sort_order: maxOrder + 1,
  });
  redirect(res, '/admin/depoimentos' + withFlash(res, 'success', 'Depoimento adicionado.'));
}

export async function testimonialUpdate(req, res, body, id) {
  const testimonial = await Q.getTestimonial(id);
  if (!testimonial) return redirect(res, '/admin/depoimentos');
  const clientName = (body.client_name || testimonial.client_name).trim();
  let provider = testimonial.provider;
  let videoId = testimonial.video_id;
  let videoUrl = testimonial.video_url;
  if (body.video_url && body.video_url.trim() !== testimonial.video_url) {
    const parsed = parseVideoUrl(body.video_url);
    if (!parsed) return redirect(res, `/admin/depoimentos/${id}/editar` + withFlash(res, 'error', 'Link de vídeo inválido.'));
    provider = parsed.provider;
    videoId = parsed.videoId;
    videoUrl = parsed.url;
  }
  await Q.updateTestimonial(id, {
    client_name: clientName,
    role: body.role || '',
    provider,
    video_id: videoId,
    video_url: videoUrl,
    sort_order: testimonial.sort_order,
  });
  redirect(res, '/admin/depoimentos' + withFlash(res, 'success', 'Depoimento atualizado.'));
}

export async function testimonialDelete(req, res, id) {
  await Q.deleteTestimonial(id);
  redirect(res, '/admin/depoimentos' + withFlash(res, 'success', 'Depoimento excluído.'));
}

export async function testimonialMove(req, res, body, id) {
  const items = await Q.listTestimonials();
  const idx = items.findIndex((t) => t.id === id);
  if (idx === -1) return redirect(res, '/admin/depoimentos');
  const swapWith = body.dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= items.length) return redirect(res, '/admin/depoimentos');
  const a = items[idx], b = items[swapWith];
  await query('UPDATE testimonials SET sort_order = $1 WHERE id = $2', [b.sort_order, a.id]);
  await query('UPDATE testimonials SET sort_order = $1 WHERE id = $2', [a.sort_order, b.id]);
  redirect(res, '/admin/depoimentos');
}

// ---------------- Comentários (visitantes comentando nas páginas de projeto) ----------------

export async function commentsPage(req, res, admin) {
  const flash = readFlash(req);
  const comments = await Q.listAllComments();
  const rows = comments
    .map(
      (c) => `<div class="panel comment-admin-item">
        <div class="comment-admin-head">
          <div>
            <b>${escapeHtml(c.author_name)}</b>
            <span class="muted"> em </span>
            <a href="/portfolio/${escapeHtml(c.project_slug)}" target="_blank">${escapeHtml(c.project_title)}</a>
            <span class="muted"> · ${escapeHtml(formatDateTimePtBr(c.created_at))}</span>
          </div>
          <form method="post" action="/admin/comentarios/${c.id}/remover" data-confirm="Excluir este comentário de &quot;${escapeHtml(c.author_name)}&quot;?">
            <button class="btn-a btn-a-sm btn-a-danger" type="submit">Excluir</button>
          </form>
        </div>
        <p class="comment-admin-content">${escapeHtml(c.content)}</p>
        <form method="post" action="/admin/comentarios/${c.id}/responder" class="comment-admin-reply-form">
          ${field({ label: 'Sua resposta (aparece publicamente logo abaixo do comentário)', name: 'admin_reply', value: c.admin_reply || '', textarea: true, rows: 2, placeholder: 'Escreva uma resposta pública (opcional)...' })}
          <div class="form-actions"><button class="btn-a btn-a-primary btn-a-sm" type="submit">Salvar resposta</button></div>
        </form>
      </div>`
    )
    .join('');
  const content = `
  <div class="panel">
    <h2>Comentários (${comments.length})</h2>
    <p class="muted" style="margin-top:-8px;">Comentários deixados por visitantes nas páginas dos projetos (fotos e vídeos). Você pode responder publicamente ou excluir comentários indesejados.</p>
  </div>
  ${comments.length ? rows : '<div class="panel"><p class="empty-hint">Nenhum comentário ainda.</p></div>'}`;
  res.end(adminLayout({ title: 'Comentários', activePath: '/admin/comentarios', admin, content, flash }));
}

export async function commentReply(req, res, body, id) {
  const comment = await Q.getComment(id);
  if (!comment) return redirect(res, '/admin/comentarios');
  await Q.updateCommentReply(id, (body.admin_reply || '').trim());
  redirect(res, '/admin/comentarios' + withFlash(res, 'success', 'Resposta salva.'));
}

export async function commentDelete(req, res, id) {
  await Q.deleteComment(id);
  redirect(res, '/admin/comentarios' + withFlash(res, 'success', 'Comentário excluído.'));
}

// ---------------- Links externos ----------------

export async function linksPage(req, res, admin) {
  const flash = readFlash(req);
  const links = await Q.listLinks();
  const rows = links
    .map(
      (l, i) => `<tr>
      <td>${escapeHtml(l.name)}</td>
      <td class="muted" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(l.url)}</td>
      <td>
        <form method="post" action="/admin/links/${l.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="up"><button class="btn-a btn-a-sm" ${i === 0 ? 'disabled' : ''}>↑</button></form>
        <form method="post" action="/admin/links/${l.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="down"><button class="btn-a btn-a-sm" ${i === links.length - 1 ? 'disabled' : ''}>↓</button></form>
      </td>
      <td class="row-actions">
        <form method="post" action="/admin/links/${l.id}/excluir" data-confirm="Excluir o link &quot;${escapeHtml(l.name)}&quot;?"><button class="btn-a btn-a-sm btn-a-danger" type="submit">Excluir</button></form>
      </td>
    </tr>`
    )
    .join('');

  const content = `
  <div class="panel">
    <h2>Novo link</h2>
    <form method="post" action="/admin/links/criar">
      <div class="form-row">
        ${field({ label: 'Nome', name: 'name', placeholder: 'Ex: YouTube', required: true })}
        ${field({ label: 'URL', name: 'url', type: 'url', placeholder: 'https://...', required: true })}
      </div>
      <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Adicionar link</button></div>
    </form>
  </div>
  <div class="panel">
    <h2>Links (${links.length})</h2>
    ${links.length ? `<table class="admin-table"><thead><tr><th>Nome</th><th>URL</th><th>Ordem</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="empty-hint">Nenhum link cadastrado. Adicione, por exemplo, YouTube, TikTok ou seu site de fotos.</p>'}
  </div>`;
  res.end(adminLayout({ title: 'Links externos', activePath: '/admin/links', admin, content, flash }));
}

export async function linkCreate(req, res, body) {
  if (!body.name || !body.url) return redirect(res, '/admin/links');
  const maxOrder = await maxSortOrder('links');
  await Q.createLink({ name: body.name, url: body.url, sort_order: maxOrder + 1 });
  redirect(res, '/admin/links' + withFlash(res, 'success', 'Link adicionado.'));
}

export async function linkDelete(req, res, id) {
  await Q.deleteLink(id);
  redirect(res, '/admin/links' + withFlash(res, 'success', 'Link excluído.'));
}

export async function linkMove(req, res, body, id) {
  const items = await Q.listLinks();
  const idx = items.findIndex((l) => l.id === id);
  if (idx === -1) return redirect(res, '/admin/links');
  const swapWith = body.dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= items.length) return redirect(res, '/admin/links');
  const a = items[idx], b = items[swapWith];
  await query('UPDATE links SET sort_order = $1 WHERE id = $2', [b.sort_order, a.id]);
  await query('UPDATE links SET sort_order = $1 WHERE id = $2', [a.sort_order, b.id]);
  redirect(res, '/admin/links');
}

// ---------------- Menu do site (pedido em 03/09/2026) ----------------
// Home/Portfólio/Sobre/Serviços/Contato eram fixos no código; agora vivem na tabela
// nav_links e dão pra editar por aqui -- adicionar, remover, renomear ou reordenar. Mesmo
// padrão de "Links externos" acima, com edição adicionada (que os links externos não têm).
// Se a lista de itens ficar vazia, server/render.js cai de volta nos 5 itens padrão
// (DEFAULT_NAV_LINKS), então o site nunca fica sem menu de navegação.

export async function menuPage(req, res, admin) {
  const flash = readFlash(req);
  const items = await Q.listNavLinks();
  const rows = items
    .map(
      (item, i) => `<tr>
      <td>${escapeHtml(item.label)}</td>
      <td class="muted" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.url)}</td>
      <td>
        <form method="post" action="/admin/menu/${item.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="up"><button class="btn-a btn-a-sm" ${i === 0 ? 'disabled' : ''}>↑</button></form>
        <form method="post" action="/admin/menu/${item.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="down"><button class="btn-a btn-a-sm" ${i === items.length - 1 ? 'disabled' : ''}>↓</button></form>
      </td>
      <td class="row-actions">
        <a class="btn-a btn-a-sm" href="/admin/menu/${item.id}/editar">Editar</a>
        <form method="post" action="/admin/menu/${item.id}/excluir" data-confirm="Excluir o item &quot;${escapeHtml(item.label)}&quot; do menu?"><button class="btn-a btn-a-sm btn-a-danger" type="submit">Excluir</button></form>
      </td>
    </tr>`
    )
    .join('');

  const content = `
  <div class="panel">
    <p class="muted" style="margin-top:0;">Estes são os itens do menu principal do site (topo de cada página e menu do celular). O item cuja URL for exatamente <code>/portfolio</code> continua ganhando automaticamente o submenu com as categorias e a setinha ao lado.</p>
  </div>
  <div class="panel">
    <h2>Novo item de menu</h2>
    <form method="post" action="/admin/menu/criar">
      <div class="form-row">
        ${field({ label: 'Texto', name: 'label', placeholder: 'Ex: Depoimentos', required: true })}
        ${field({ label: 'URL', name: 'url', placeholder: '/depoimentos ou https://...', required: true, help: 'Um caminho do próprio site (ex: /sobre) ou um link completo (https://...) pra abrir outra página.' })}
      </div>
      <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Adicionar ao menu</button></div>
    </form>
  </div>
  <div class="panel">
    <h2>Itens do menu (${items.length})</h2>
    ${items.length ? `<table class="admin-table"><thead><tr><th>Texto</th><th>URL</th><th>Ordem</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="empty-hint">Nenhum item no menu ainda. Adicione o primeiro acima.</p>'}
  </div>`;
  res.end(adminLayout({ title: 'Menu do site', activePath: '/admin/menu', admin, content, flash }));
}

export async function menuEditPage(req, res, admin, id) {
  const item = await Q.getNavLink(id);
  if (!item) return redirect(res, '/admin/menu');
  const content = `
  <div class="panel">
    <h2>Editar item do menu</h2>
    <form method="post" action="/admin/menu/${item.id}/atualizar">
      ${field({ label: 'Texto', name: 'label', value: item.label, required: true })}
      ${field({ label: 'URL', name: 'url', value: item.url, required: true, help: 'Um caminho do próprio site (ex: /sobre) ou um link completo (https://...).' })}
      <div class="form-actions">
        <button class="btn-a btn-a-primary" type="submit">Salvar</button>
        <a class="btn-a" href="/admin/menu">Cancelar</a>
      </div>
    </form>
  </div>`;
  res.end(adminLayout({ title: 'Editar item do menu', activePath: '/admin/menu', admin, content }));
}

export async function menuCreate(req, res, body) {
  const label = (body.label || '').trim();
  const url = (body.url || '').trim();
  if (!label || !url) return redirect(res, '/admin/menu');
  const maxOrder = await maxSortOrder('nav_links');
  await Q.createNavLink({ label, url, sort_order: maxOrder + 1 });
  redirect(res, '/admin/menu' + withFlash(res, 'success', 'Item adicionado ao menu.'));
}

export async function menuUpdate(req, res, body, id) {
  const item = await Q.getNavLink(id);
  if (!item) return redirect(res, '/admin/menu');
  const label = (body.label || '').trim() || item.label;
  const url = (body.url || '').trim() || item.url;
  await Q.updateNavLink(id, { label, url, sort_order: item.sort_order });
  redirect(res, '/admin/menu' + withFlash(res, 'success', 'Item do menu atualizado.'));
}

export async function menuDelete(req, res, id) {
  await Q.deleteNavLink(id);
  redirect(res, '/admin/menu' + withFlash(res, 'success', 'Item removido do menu.'));
}

export async function menuMove(req, res, body, id) {
  const items = await Q.listNavLinks();
  const idx = items.findIndex((l) => l.id === id);
  if (idx === -1) return redirect(res, '/admin/menu');
  const swapWith = body.dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= items.length) return redirect(res, '/admin/menu');
  const a = items[idx], b = items[swapWith];
  await query('UPDATE nav_links SET sort_order = $1 WHERE id = $2', [b.sort_order, a.id]);
  await query('UPDATE nav_links SET sort_order = $1 WHERE id = $2', [a.sort_order, b.id]);
  redirect(res, '/admin/menu');
}

// ---------------- Biografia ----------------

export async function bioPage(req, res, admin) {
  const flash = readFlash(req);
  const bio = await Q.getBio();
  const bioPhotos = await Q.listBioPhotos();
  const galleryPhotos = await Q.listBioGalleryPhotos();
  const content = `
  <div class="panel">
    <form method="post" action="/admin/bio/atualizar">
      <div class="form-row">
        ${field({ label: 'Nome', name: 'name', value: bio.name })}
        ${field({ label: 'Título profissional', name: 'professional_title', value: bio.professional_title, placeholder: 'Ex: Videomaker & Fotógrafo' })}
      </div>
      ${field({ label: 'Biografia', name: 'biography', value: bio.biography, textarea: true, rows: 6 })}
      ${field({ label: 'Trajetória', name: 'trajectory', value: bio.trajectory, textarea: true, rows: 6, help: 'Sua história, desde quando começou até hoje.' })}
      ${field({ label: 'Especialidades', name: 'specialties', value: bio.specialties, textarea: true, rows: 3, help: 'Uma por linha ou separadas por vírgula. Ex: Casamentos, Drone, Videoclipes' })}
      ${field({ label: 'Equipamentos / estrutura (opcional)', name: 'equipment', value: bio.equipment, textarea: true, rows: 3 })}
      <div class="form-field" data-single-upload>
        <label>Foto de perfil</label>
        <input type="file" accept="image/*">
        <input type="hidden" name="profile_photo_data">
        <img data-preview src="${escapeHtml(bio.profile_photo || '')}" style="max-width:160px;border-radius:6px;margin-top:8px;display:${bio.profile_photo ? 'block' : 'none'};">
      </div>
      ${field({ label: 'Texto do botão de contato', name: 'cta_text', value: bio.cta_text })}
      <div class="form-row">
        ${field({ label: 'Título da galeria de bastidores', name: 'gallery_title', value: bio.gallery_title, placeholder: 'Ex: No set com a NJFILMES', help: 'Aparece acima da faixa de fotos "Bastidores", na página Sobre.' })}
        ${field({ label: 'Título da seção Trajetória', name: 'trajectory_title', value: bio.trajectory_title, placeholder: 'Ex: Uma jornada pela imagem', help: 'Aparece acima do texto de trajetória, na página Sobre.' })}
      </div>
      <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Salvar biografia</button></div>
    </form>
  </div>
  <div class="panel">
    <h2>Fotos da página Sobre (galeria que fica passando)</h2>
    <p class="muted" style="margin-top:-8px;">Envie quantas fotos quiser aqui — elas vão passando (trocando) automaticamente na página Sobre, na foto grande ao lado da sua biografia.</p>
    <div class="upload-drop" data-bio-photos-upload>
      <input type="file" accept="image/*" multiple>
      <p>Clique aqui ou arraste as fotos para enviar</p>
      <div id="bio-photos-preview"></div>
      <p data-bio-photos-status style="margin-top:10px;font-size:0.82rem;"></p>
    </div>
    ${bioPhotos.length ? `<div class="photo-grid">${bioPhotos
      .map(
        (p) => `<div class="photo-card">
        <img src="${escapeHtml(p.filename)}" alt="">
        <div class="pc-body">
          <div class="pc-actions">
            <form method="post" action="/admin/bio/fotos/${p.id}/excluir" data-confirm="Excluir esta foto?"><button class="btn-a btn-a-sm btn-a-danger">Excluir</button></form>
          </div>
        </div>
      </div>`
      )
      .join('')}</div>` : '<p class="empty-hint">Nenhuma foto adicionada ainda.</p>'}
  </div>
  <div class="panel">
    <h2>Fotos da galeria "Bastidores" (faixa que rola sozinha)</h2>
    <p class="muted" style="margin-top:-8px;">Essas são as fotos da faixa "${escapeHtml(bio.gallery_title || 'No set com a NJFILMES')}", na página Sobre. Envie, reordene com as setas ou exclua — sem precisar mexer em código.</p>
    <div class="upload-drop" data-bio-gallery-upload>
      <input type="file" accept="image/*" multiple>
      <p>Clique aqui ou arraste as fotos para enviar</p>
      <div id="bio-gallery-preview"></div>
      <p data-bio-gallery-status style="margin-top:10px;font-size:0.82rem;"></p>
    </div>
    ${galleryPhotos.length ? `<div class="photo-grid">${galleryPhotos
      .map(
        (p, i) => `<div class="photo-card">
        <img src="${escapeHtml(p.filename)}" alt="">
        <div class="pc-body">
          <div class="pc-actions">
            <form method="post" action="/admin/bio/galeria/${p.id}/mover"><input type="hidden" name="dir" value="up"><button class="btn-a btn-a-sm" type="submit" ${i === 0 ? 'disabled' : ''}>↑</button></form>
            <form method="post" action="/admin/bio/galeria/${p.id}/mover"><input type="hidden" name="dir" value="down"><button class="btn-a btn-a-sm" type="submit" ${i === galleryPhotos.length - 1 ? 'disabled' : ''}>↓</button></form>
            <form method="post" action="/admin/bio/galeria/${p.id}/excluir" data-confirm="Excluir esta foto da galeria de bastidores?"><button class="btn-a btn-a-sm btn-a-danger">Excluir</button></form>
          </div>
        </div>
      </div>`
      )
      .join('')}</div>` : '<p class="empty-hint">Nenhuma foto adicionada ainda.</p>'}
  </div>`;
  res.end(adminLayout({ title: 'Biografia / Sobre', activePath: '/admin/bio', admin, content, flash }));
}

export async function bioUpdate(req, res, body) {
  const bio = await Q.getBio();
  let profile_photo = bio.profile_photo;
  let photoFailed = false;
  if (body.profile_photo_data) {
    try { profile_photo = await saveMiscImage(body.profile_photo_data); } catch (e) { photoFailed = true; console.error('Erro ao salvar foto de perfil:', e.message); }
  }
  await Q.updateBio({
    name: body.name || '',
    professional_title: body.professional_title || '',
    biography: body.biography || '',
    trajectory: body.trajectory || '',
    specialties: body.specialties || '',
    equipment: body.equipment || '',
    profile_photo,
    cta_text: body.cta_text || '',
    gallery_title: body.gallery_title || 'No set com a NJFILMES',
    trajectory_title: body.trajectory_title || 'Uma jornada pela imagem',
  });
  redirect(res, '/admin/bio' + withFlash(res, photoFailed ? 'error' : 'success', photoFailed ? 'Biografia atualizada, mas a nova foto de perfil não pôde ser salva (a antiga foi mantida).' : 'Biografia atualizada.'));
}

export async function bioPhotosUpload(req, res, body) {
  const photos = Array.isArray(body.photos) ? body.photos : [];
  if (!photos.length) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'Nenhuma foto recebida.' }));
  }
  let saved = 0;
  for (const dataUrl of photos) {
    try {
      const url = await saveMiscImage(dataUrl);
      await Q.addBioPhoto(url);
      saved += 1;
    } catch (err) {
      console.error('Erro ao salvar foto da bio:', err.message);
    }
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, saved }));
}

export async function bioPhotoDelete(req, res, id) {
  await Q.deleteBioPhoto(id);
  redirect(res, '/admin/bio' + withFlash(res, 'success', 'Foto excluída.'));
}

export async function bioGalleryPhotosUpload(req, res, body) {
  const photos = Array.isArray(body.photos) ? body.photos : [];
  if (!photos.length) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'Nenhuma foto recebida.' }));
  }
  let saved = 0;
  for (const dataUrl of photos) {
    try {
      const url = await saveMiscImage(dataUrl);
      await Q.addBioGalleryPhoto(url);
      saved += 1;
    } catch (err) {
      console.error('Erro ao salvar foto da galeria de bastidores:', err.message);
    }
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, saved }));
}

export async function bioGalleryPhotoDelete(req, res, id) {
  await Q.deleteBioGalleryPhoto(id);
  redirect(res, '/admin/bio' + withFlash(res, 'success', 'Foto excluída.'));
}

export async function bioGalleryPhotoMove(req, res, body, id) {
  const items = await Q.listBioGalleryPhotos();
  const idx = items.findIndex((p) => p.id === id);
  if (idx === -1) return redirect(res, '/admin/bio');
  const swapWith = body.dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= items.length) return redirect(res, '/admin/bio');
  const a = items[idx], b = items[swapWith];
  await query('UPDATE bio_gallery_photos SET sort_order = $1 WHERE id = $2', [b.sort_order, a.id]);
  await query('UPDATE bio_gallery_photos SET sort_order = $1 WHERE id = $2', [a.sort_order, b.id]);
  redirect(res, '/admin/bio');
}

// ---------------- Fotos de destaque da Home (crossfade) ----------------

export async function heroPhotosUpload(req, res, body) {
  const photos = Array.isArray(body.photos) ? body.photos : [];
  if (!photos.length) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'Nenhuma foto recebida.' }));
  }
  let saved = 0;
  for (const dataUrl of photos) {
    try {
      const url = await saveMiscImage(dataUrl);
      await Q.addHeroPhoto(url);
      saved += 1;
    } catch (err) {
      console.error('Erro ao salvar foto de destaque da Home:', err.message);
    }
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, saved }));
}

export async function heroPhotoDelete(req, res, id) {
  await Q.deleteHeroPhoto(id);
  redirect(res, '/admin/configuracoes' + withFlash(res, 'success', 'Foto excluída.'));
}

export async function heroPhotoMove(req, res, body, id) {
  const items = await Q.listHeroPhotos();
  const idx = items.findIndex((p) => p.id === id);
  if (idx === -1) return redirect(res, '/admin/configuracoes');
  const swapWith = body.dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= items.length) return redirect(res, '/admin/configuracoes');
  const a = items[idx], b = items[swapWith];
  await query('UPDATE hero_photos SET sort_order = $1 WHERE id = $2', [b.sort_order, a.id]);
  await query('UPDATE hero_photos SET sort_order = $1 WHERE id = $2', [a.sort_order, b.id]);
  redirect(res, '/admin/configuracoes');
}

// ---------------- Configurações ----------------

export async function settingsPage(req, res, admin) {
  const flash = readFlash(req);
  const s = await Q.getSettings();
  const heroPhotos = await Q.listHeroPhotos();
  const content = `
  <div class="panel">
    <h2>Identidade e SEO</h2>
    <form method="post" action="/admin/configuracoes/atualizar">
      <div class="form-row">
        ${field({ label: 'Nome do site', name: 'site_name', value: s.site_name })}
        ${field({ label: 'Slogan curto', name: 'tagline', value: s.tagline })}
      </div>
      ${field({ label: 'Título de destaque na Home', name: 'hero_headline', value: s.hero_headline })}
      ${field({ label: 'Subtítulo da Home', name: 'hero_subheadline', value: s.hero_subheadline, textarea: true, rows: 2 })}
      ${field({ label: 'URL do vídeo de fundo da Home (opcional, .mp4)', name: 'hero_video_url', value: s.hero_video_url, help: 'Link direto para um arquivo de vídeo .mp4 hospedado (ex: no seu storage). Deixe vazio para usar imagem.' })}
      <div class="form-field" data-single-upload>
        <label>Foto de destaque da Home (fundo da primeira tela do site)</label>
        <input type="file" accept="image/*">
        <input type="hidden" name="hero_photo_data">
        <img data-preview src="${escapeHtml(s.hero_photo || '/img/hero-poster.webp')}" style="max-width:280px;border-radius:6px;margin-top:8px;display:block;">
        <input type="hidden" name="hero_photo_existing" value="${escapeHtml(s.hero_photo || '')}">
        <small>Envie uma foto na horizontal, de boa qualidade (ideal acima de 1600px de largura). O efeito de escurecido/película que já existe no site continua funcionando automaticamente em cima da foto nova, sem precisar mexer em mais nada. Se não enviar nenhuma, o site continua usando a foto atual.</small>
      </div>
      ${field({ label: 'Título para o Google (meta title)', name: 'meta_title', value: s.meta_title })}
      ${field({ label: 'Descrição para o Google (meta description)', name: 'meta_description', value: s.meta_description, textarea: true, rows: 2 })}
      <div class="form-field" data-single-upload>
        <label>Imagem de compartilhamento (aparece quando alguém envia o link do site no WhatsApp, Instagram etc.)</label>
        <input type="file" accept="image/*">
        <input type="hidden" name="og_image_data">
        ${s.og_image ? `<img data-preview src="${escapeHtml(s.og_image)}" style="max-width:280px;border-radius:6px;margin-top:8px;display:block;">` : `<img data-preview src="" style="max-width:280px;border-radius:6px;margin-top:8px;display:none;">`}
        <input type="hidden" name="og_image_existing" value="${escapeHtml(s.og_image || '')}">
        <small>Tamanho ideal: 1200x630px. Se não enviar nenhuma, o site usa a imagem padrão (logo NJFILMES).</small>
      </div>
      ${field({ label: 'Texto do rodapé', name: 'footer_text', value: s.footer_text })}
      <h2 style="margin-top:32px;">Contato</h2>
      ${field({ label: 'Título da página de Contato', name: 'contact_headline', value: s.contact_headline, help: 'Aparece grande no topo da página de Contato.' })}
      ${field({ label: 'E-mail de contato', name: 'contact_email', value: s.contact_email, type: 'email', placeholder: 'contato@njfilmes.com.br', help: 'Aparece na página de Contato do site.' })}
      ${field({ label: 'Número do WhatsApp', name: 'whatsapp_number', value: s.whatsapp_number, placeholder: 'Ex: 5571986817816 (DDI+DDD+número, só números)' })}
      ${field({ label: 'Mensagem automática', name: 'whatsapp_message', value: s.whatsapp_message, textarea: true, rows: 2 })}
      ${field({ label: 'Título do bloco "Orçamento rápido"', name: 'contact_budget_title', value: s.contact_budget_title })}
      ${field({ label: 'Texto do bloco "Orçamento rápido"', name: 'contact_budget_text', value: s.contact_budget_text, textarea: true, rows: 3 })}
      ${field({ label: 'Texto do botão do WhatsApp', name: 'contact_whatsapp_button_text', value: s.contact_whatsapp_button_text })}
      ${field({ label: 'Título do bloco "Outros canais"', name: 'contact_channels_title', value: s.contact_channels_title })}
      <h2 style="margin-top:32px;">Redes sociais</h2>
      <div class="form-row">
        ${field({ label: 'Instagram', name: 'instagram_url', value: s.instagram_url, type: 'url' })}
        ${field({ label: 'YouTube', name: 'youtube_url', value: s.youtube_url, type: 'url' })}
      </div>
      <div class="form-row">
        ${field({ label: 'Vimeo', name: 'vimeo_url', value: s.vimeo_url, type: 'url' })}
        ${field({ label: 'TikTok', name: 'tiktok_url', value: s.tiktok_url, type: 'url' })}
      </div>
      ${field({ label: 'Facebook', name: 'facebook_url', value: s.facebook_url, type: 'url' })}
      <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Salvar configurações</button></div>
    </form>
  </div>
  <div class="panel">
    <h2>Mais fotos de destaque da Home (passam com transição suave)</h2>
    <p class="muted" style="margin-top:-8px;">Além da foto de destaque acima, envie aqui outras fotos suas pra elas ficarem se revezando na primeira tela do site, uma passando pra outra suavemente. A foto de destaque acima sempre entra como a primeira do rodízio; as que você enviar aqui entram depois, na ordem que você organizar. Só funciona quando não tem vídeo de fundo configurado.</p>
    <div class="upload-drop" data-hero-photos-upload>
      <input type="file" accept="image/*" multiple>
      <p>Clique aqui ou arraste as fotos para enviar</p>
      <div id="hero-photos-preview"></div>
      <p data-hero-photos-status style="margin-top:10px;font-size:0.82rem;"></p>
    </div>
    ${heroPhotos.length ? `<div class="photo-grid">${heroPhotos
      .map(
        (p, i) => `<div class="photo-card">
        <img src="${escapeHtml(p.filename)}" alt="">
        <div class="pc-body">
          <div class="pc-actions">
            <form method="post" action="/admin/hero/fotos/${p.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="up"><button class="btn-a btn-a-sm" ${i === 0 ? 'disabled' : ''}>↑</button></form>
            <form method="post" action="/admin/hero/fotos/${p.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="down"><button class="btn-a btn-a-sm" ${i === heroPhotos.length - 1 ? 'disabled' : ''}>↓</button></form>
            <form method="post" action="/admin/hero/fotos/${p.id}/excluir" data-confirm="Excluir esta foto do rodízio da Home?"><button class="btn-a btn-a-sm btn-a-danger">Excluir</button></form>
          </div>
        </div>
      </div>`
      )
      .join('')}</div>` : '<p class="empty-hint">Nenhuma foto extra adicionada ainda — só a foto de destaque acima está sendo usada.</p>'}
  </div>
  <div class="panel">
    <h2>Minha conta</h2>
    <p class="muted" style="margin-top:-8px;">Altere sua senha de acesso ao painel administrativo.</p>
    <form method="post" action="/admin/conta/senha">
      ${field({ label: 'Senha atual', name: 'current_password', type: 'password', required: true })}
      <div class="form-row">
        ${field({ label: 'Nova senha', name: 'new_password', type: 'password', required: true, help: 'Mínimo 6 caracteres.' })}
        ${field({ label: 'Confirmar nova senha', name: 'confirm_password', type: 'password', required: true })}
      </div>
      <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Alterar senha</button></div>
    </form>
  </div>`;
  res.end(adminLayout({ title: 'Configurações', activePath: '/admin/configuracoes', admin, content, flash }));
}

export async function changePasswordSubmit(req, res, body, admin) {
  const { current_password, new_password, confirm_password } = body;
  const fresh = await findAdminByEmail(admin.email);
  if (!fresh || !verifyPassword(current_password || '', fresh.password_hash, fresh.salt)) {
    return redirect(res, '/admin/configuracoes' + withFlash(res, 'error', 'Senha atual incorreta.'));
  }
  if (!new_password || new_password.length < 6) {
    return redirect(res, '/admin/configuracoes' + withFlash(res, 'error', 'A nova senha precisa ter pelo menos 6 caracteres.'));
  }
  if (new_password !== confirm_password) {
    return redirect(res, '/admin/configuracoes' + withFlash(res, 'error', 'A confirmação de senha não confere.'));
  }
  const { hash, salt } = hashPassword(new_password);
  await query('UPDATE admin_users SET password_hash = $1, salt = $2 WHERE id = $3', [hash, salt, fresh.id]);
  redirect(res, '/admin/configuracoes' + withFlash(res, 'success', 'Senha alterada com sucesso.'));
}

export async function settingsUpdate(req, res, body) {
  // Imagem de compartilhamento (og_image): mantém a atual se nada de novo for enviado;
  // se o upload falhar (arquivo inválido/grande demais), também mantém a atual em vez de apagar.
  let og_image = body.og_image_existing || '';
  if (body.og_image_data) {
    try { og_image = await saveMiscImage(body.og_image_data); } catch { /* mantém imagem anterior */ }
  }
  // Foto de destaque da Home: mesma lógica (mantém a atual se nada de novo for enviado
  // ou se o upload falhar). Vazio = continua usando a imagem padrão do site.
  let hero_photo = body.hero_photo_existing || '';
  if (body.hero_photo_data) {
    try { hero_photo = await saveMiscImage(body.hero_photo_data); } catch { /* mantém foto anterior */ }
  }
  await Q.updateSettings({
    site_name: body.site_name || 'NJFILMES',
    tagline: body.tagline || '',
    hero_headline: body.hero_headline || '',
    hero_subheadline: body.hero_subheadline || '',
    hero_video_url: body.hero_video_url || '',
    hero_photo,
    meta_title: body.meta_title || '',
    meta_description: body.meta_description || '',
    og_image,
    footer_text: body.footer_text || '',
    contact_headline: body.contact_headline || '',
    contact_email: body.contact_email || '',
    whatsapp_number: body.whatsapp_number || '',
    whatsapp_message: body.whatsapp_message || '',
    contact_budget_title: body.contact_budget_title || '',
    contact_budget_text: body.contact_budget_text || '',
    contact_whatsapp_button_text: body.contact_whatsapp_button_text || '',
    contact_channels_title: body.contact_channels_title || '',
    instagram_url: body.instagram_url || '',
    youtube_url: body.youtube_url || '',
    vimeo_url: body.vimeo_url || '',
    tiktok_url: body.tiktok_url || '',
    facebook_url: body.facebook_url || '',
  });
  redirect(res, '/admin/configuracoes' + withFlash(res, 'success', 'Configurações salvas.'));
}

// ---------------- Projetos ----------------

function renderProjectsTable(projects) {
  if (!projects.length) return '<p class="empty-hint">Nenhum projeto ainda. Clique em "Novo projeto" para criar o primeiro.</p>';
  const rows = projects
    .map(
      (p) => `<tr>
      <td><img class="thumb-sm" src="${escapeHtml(p.cover_photo || '/img/project-placeholder.jpg')}" alt=""></td>
      <td><a href="/admin/projetos/${p.id}">${escapeHtml(p.title)}</a></td>
      <td class="muted">${escapeHtml(p.category_name || '—')}</td>
      <td>${p.published ? '<span class="tag tag-published">Publicado</span>' : '<span class="tag tag-draft">Rascunho</span>'} ${p.featured ? '<span class="tag tag-featured">Destaque</span>' : ''} ${p.hide_from_recent ? '<span class="tag">Fora da vitrine</span>' : ''} ${p.hide_gallery ? '<span class="tag">Galeria oculta</span>' : ''}</td>
      <td class="row-actions">
        <a class="btn-a btn-a-sm" href="/admin/projetos/${p.id}">Editar</a>
        <form method="post" action="/admin/projetos/${p.id}/excluir" data-confirm="Excluir o projeto &quot;${escapeHtml(p.title)}&quot;? Isso remove também as fotos e vídeos dele."><button class="btn-a btn-a-sm btn-a-danger" type="submit">Excluir</button></form>
      </td>
    </tr>`
    )
    .join('');
  return `<table class="admin-table"><thead><tr><th>Capa</th><th>Título</th><th>Categoria</th><th>Status</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export async function projectsListPage(req, res, admin) {
  const flash = readFlash(req);
  const projects = await Q.listAllProjectsForAdmin();
  const content = `
  <div class="panel-head" style="margin-bottom:18px;">
    <h2 style="margin:0;">Projetos (${projects.length})</h2>
    <a class="btn-a btn-a-primary" href="/admin/projetos/novo">+ Novo projeto</a>
  </div>
  <div class="panel">${renderProjectsTable(projects)}</div>`;
  res.end(adminLayout({ title: 'Projetos', activePath: '/admin/projetos', admin, content, flash }));
}

function projectInfoForm({ action, project = {}, categories }) {
  return `<form method="post" action="${action}">
    <div class="form-row">
      ${field({ label: 'Título do projeto', name: 'title', value: project.title, required: true, placeholder: 'Ex: Casamento de João & Maria' }).replace('<input', '<input data-slug-source')}
      ${field({ label: 'URL (slug)', name: 'slug', value: project.slug, help: 'Endereço final: /portfolio/seu-texto-aqui' }).replace('<input', '<input data-slug-target')}
    </div>
    <div class="form-row">
      ${selectField({ label: 'Categoria', name: 'category_id', selected: project.category_id, options: [{ value: '', label: '— Selecione —' }, ...categories.map((c) => ({ value: c.id, label: c.name }))] })}
      ${field({ label: 'Data', name: 'project_date', type: 'date', value: project.project_date })}
    </div>
    ${field({ label: 'Local', name: 'location', value: project.location, placeholder: 'Ex: Salvador, BA' })}
    ${field({ label: 'Descrição', name: 'description', value: project.description, textarea: true, rows: 5 })}
    ${field({ label: 'Créditos (opcional)', name: 'credits', value: project.credits, placeholder: 'Ex: Direção: NJ · Assistente: ...' })}
    ${field({ label: 'Informações adicionais (opcional)', name: 'additional_info', value: project.additional_info, textarea: true, rows: 3 })}
    <div class="form-row">
      ${checkboxField({ label: 'Publicado (visível no site)', name: 'published', checked: !!project.published })}
      ${checkboxField({ label: 'Projeto em destaque na Home', name: 'featured', checked: !!project.featured })}
    </div>
    <div class="form-row">
      ${checkboxField({ label: 'Ocultar da vitrine "Portfólio selecionado" da Home', name: 'hide_from_recent', checked: !!project.hide_from_recent })}
    </div>
    <p style="margin-top:-8px;color:var(--muted, #888);font-size:0.85rem;">A vitrine "Portfólio selecionado" mostra automaticamente os projetos publicados mais recentes. Marque esta opção pra esse projeto continuar publicado e acessível pelo Portfólio, só sem aparecer nessa vitrine da Home.</p>
    <div class="form-row">
      ${checkboxField({ label: 'Ocultar a seção "Galeria" na página deste projeto', name: 'hide_gallery', checked: !!project.hide_gallery })}
    </div>
    <p style="margin-top:-8px;color:var(--muted, #888);font-size:0.85rem;">Esconde só a seção "Galeria" (com as fotos da aba Fotos) na página pública deste projeto. A foto de capa continua normal nos cards da Home e do Portfólio — isso não apaga nem afeta nenhuma foto, só some com essa seção específica na página do projeto.</p>
    ${field({ label: 'Título da seção de fotos', name: 'gallery_title', value: project.gallery_title || 'Galeria', placeholder: 'Galeria' })}
    <p style="margin-top:-8px;color:var(--muted, #888);font-size:0.85rem;">O nome que aparece acima das fotos deste projeto na página pública (por padrão "Galeria"). Pode trocar por qualquer texto, ex: "Bastidores" ou "Fotos do dia".</p>
    <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Salvar</button></div>
  </form>`;
}

export async function projectNewPage(req, res, admin) {
  const categories = await Q.listCategories();
  // Voltou a vir desmarcado (Galeria visível por padrão) — pedido do usuário em 03/09/2026: a
  // Galeria (álbum de fotos com zoom) passou a ser uma função normal de todo projeto, e não faz
  // sentido nascer escondida. Dá pra marcar a caixa manualmente se algum projeto específico não
  // precisar dessa seção.
  const content = `<div class="panel"><h2>Novo projeto</h2>${projectInfoForm({ action: '/admin/projetos/criar', categories })}</div>`;
  res.end(adminLayout({ title: 'Novo projeto', activePath: '/admin/projetos', admin, content }));
}

export async function projectCreate(req, res, body) {
  const title = (body.title || '').trim();
  if (!title) return redirect(res, '/admin/projetos/novo');
  const slug = await uniqueSlug(['projects', 'categories'], (body.slug || '').trim() || title);
  const id = await Q.createProject({
    title,
    slug,
    category_id: body.category_id ? Number(body.category_id) : null,
    description: body.description,
    project_date: body.project_date,
    location: body.location,
    credits: body.credits,
    additional_info: body.additional_info,
    published: !!body.published,
    featured: !!body.featured,
    hide_from_recent: !!body.hide_from_recent,
    hide_gallery: !!body.hide_gallery,
    gallery_title: (body.gallery_title || '').trim() || 'Galeria',
  });
  redirect(res, `/admin/projetos/${id}` + withFlash(res, 'success', 'Projeto criado! Agora adicione vídeos e fotos.'));
}

function projectTabs(id, active) {
  const tabs = [
    ['info', 'Informações'],
    ['videos', 'Vídeos'],
    ['fotos', 'Fotos'],
  ];
  return `<div class="tabs">${tabs
    .map(([key, label]) => `<a class="tab-link ${active === key ? 'active' : ''}" href="/admin/projetos/${id}${key === 'info' ? '' : '/' + key}">${label}</a>`)
    .join('')}</div>`;
}

export async function projectEditPage(req, res, admin, id, tab = 'info') {
  const project = await Q.getProject(id);
  if (!project) return redirect(res, '/admin/projetos');
  const flash = readFlash(req);
  const categories = await Q.listCategories();

  let body;
  if (tab === 'videos') {
    body = `
    ${projectTabs(id, 'videos')}
    <div class="panel">
      <h2>Adicionar vídeo</h2>
      <p class="muted" style="margin-top:-8px;">Cole o link do YouTube, Vimeo, um arquivo de vídeo direto (.mp4) ou um link de Mega, Google Drive, WeTransfer ou Dropbox. O sistema identifica automaticamente: YouTube, Vimeo, Mega e Google Drive tocam direto na página (Mega e Drive precisam estar com o link compartilhado como "qualquer pessoa pode ver"); WeTransfer e links que não dá pra converter aparecem como um botão "Assistir/baixar".</p>
      <form method="post" action="/admin/projetos/${id}/videos/criar">
        <div class="form-row">
          ${field({ label: 'URL do vídeo', name: 'url', required: true, placeholder: 'https://www.youtube.com/watch?v=...' })}
          ${field({ label: 'Título (opcional)', name: 'title', placeholder: 'Ex: Making of' })}
        </div>
        <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Adicionar vídeo</button></div>
      </form>
    </div>
    <div class="panel">
      <h2>Vídeos do projeto (${project.videos.length})</h2>
      ${project.videos.length ? project.videos.map((v) => `
        <div class="video-item">
          <div class="vi-info"><b>${escapeHtml(v.title || v.provider)}</b><span>${escapeHtml(v.url)}</span></div>
          <form method="post" action="/admin/projetos/${id}/videos/${v.id}/excluir" data-confirm="Remover este vídeo?"><button class="btn-a btn-a-sm btn-a-danger">Remover</button></form>
        </div>`).join('') : '<p class="empty-hint">Nenhum vídeo adicionado ainda.</p>'}
    </div>`;
  } else if (tab === 'fotos') {
    body = `
    ${projectTabs(id, 'fotos')}
    <div class="panel">
      <h2>Enviar fotos</h2>
      <p class="muted" style="margin-top:-8px;">Selecione várias fotos de uma vez. Elas são otimizadas e uma miniatura é gerada automaticamente.</p>
      <div class="upload-drop" data-upload-drop data-project-id="${id}">
        <input type="file" accept="image/*" multiple>
        <p>Clique aqui ou arraste as fotos para enviar</p>
        <div id="upload-preview"></div>
        <p data-upload-status style="margin-top:10px;font-size:0.82rem;"></p>
      </div>
    </div>
    <div class="panel">
      <h2>Fotos do projeto (${project.photos.length})</h2>
      ${project.photos.length ? `<div class="photo-grid">${project.photos
        .map(
          (p, i) => `<div class="photo-card">
          <img src="${escapeHtml(p.thumb_filename)}" alt="">
          <div class="pc-body">
            ${p.is_cover ? '<span class="is-cover-badge">Capa</span>' : ''}
            <form method="post" action="/admin/projetos/${id}/fotos/${p.id}/legenda">
              <input type="text" name="caption" value="${escapeHtml(p.caption || '')}" placeholder="Legenda (opcional)">
              <button class="btn-a btn-a-sm" type="submit">Salvar legenda</button>
            </form>
            <div class="pc-actions">
              ${!p.is_cover ? `<form method="post" action="/admin/projetos/${id}/fotos/${p.id}/capa"><button class="btn-a btn-a-sm">Definir capa</button></form>` : ''}
              <form method="post" action="/admin/projetos/${id}/fotos/${p.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="up"><button class="btn-a btn-a-sm" ${i === 0 ? 'disabled' : ''}>↑</button></form>
              <form method="post" action="/admin/projetos/${id}/fotos/${p.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="down"><button class="btn-a btn-a-sm" ${i === project.photos.length - 1 ? 'disabled' : ''}>↓</button></form>
              <form method="post" action="/admin/projetos/${id}/fotos/${p.id}/excluir" data-confirm="Excluir esta foto?"><button class="btn-a btn-a-sm btn-a-danger">Excluir</button></form>
            </div>
          </div>
        </div>`
        )
        .join('')}</div>` : '<p class="empty-hint">Nenhuma foto enviada ainda.</p>'}
    </div>`;
  } else {
    body = `${projectTabs(id, 'info')}<div class="panel"><h2>Informações do projeto</h2>${projectInfoForm({ action: `/admin/projetos/${id}/atualizar`, project, categories })}</div>
    <div class="panel">
      <h3>Excluir projeto</h3>
      <p class="muted">Essa ação remove o projeto, suas fotos e vídeos permanentemente.</p>
      <form method="post" action="/admin/projetos/${id}/excluir" data-confirm="Excluir o projeto &quot;${escapeHtml(project.title)}&quot; e todo o seu conteúdo?"><button class="btn-a btn-a-danger" type="submit">Excluir projeto</button></form>
    </div>`;
  }

  res.end(adminLayout({ title: project.title, activePath: '/admin/projetos', admin, content: body, flash }));
}

export async function projectUpdate(req, res, body, id) {
  const project = await Q.getProject(id);
  if (!project) return redirect(res, '/admin/projetos');
  const title = (body.title || project.title).trim();
  const slug = (body.slug || '').trim() ? await uniqueSlug(['projects', 'categories'], body.slug, id) : project.slug;
  await Q.updateProject(id, {
    title,
    slug,
    category_id: body.category_id ? Number(body.category_id) : null,
    description: body.description,
    project_date: body.project_date,
    location: body.location,
    cover_photo: project.cover_photo,
    credits: body.credits,
    additional_info: body.additional_info,
    published: !!body.published,
    featured: !!body.featured,
    hide_from_recent: !!body.hide_from_recent,
    hide_gallery: !!body.hide_gallery,
    gallery_title: (body.gallery_title || '').trim() || 'Galeria',
    sort_order: project.sort_order,
  });
  redirect(res, `/admin/projetos/${id}` + withFlash(res, 'success', 'Projeto atualizado.'));
}

export async function projectDelete(req, res, id) {
  await Q.deleteProject(id);
  redirect(res, '/admin/projetos' + withFlash(res, 'success', 'Projeto excluído.'));
}

export async function projectVideoCreate(req, res, body, id) {
  const parsed = parseVideoUrl(body.url);
  if (!parsed) return redirect(res, `/admin/projetos/${id}/videos` + withFlash(res, 'error', 'Link de vídeo inválido.'));
  const maxOrder = await maxSortOrder('project_videos', 'project_id', id);
  await Q.addProjectVideo(id, { provider: parsed.provider, video_id: parsed.videoId, url: parsed.url, title: body.title, sort_order: maxOrder + 1 });
  redirect(res, `/admin/projetos/${id}/videos` + withFlash(res, 'success', 'Vídeo adicionado.'));
}

export async function projectVideoDelete(req, res, id, videoId) {
  await Q.deleteProjectVideo(videoId);
  redirect(res, `/admin/projetos/${id}/videos`);
}

export async function projectPhotosUpload(req, res, body, id) {
  const project = await Q.getProject(id);
  if (!project) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'Projeto não encontrado.' }));
  }
  const photos = Array.isArray(body.photos) ? body.photos : [];
  if (!photos.length) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'Nenhuma foto recebida.' }));
  }
  let order = await maxSortOrder('photos', 'project_id', id);
  let saved = 0;
  const isFirstBatch = project.photos.length === 0;
  for (const dataUrl of photos) {
    try {
      const { filename, thumbFilename } = await saveProjectPhoto(dataUrl);
      order += 1;
      await Q.addPhoto(id, { filename, thumbFilename, sort_order: order, is_cover: isFirstBatch && saved === 0 ? 1 : 0 });
      if (isFirstBatch && saved === 0) {
        await query('UPDATE projects SET cover_photo = $1 WHERE id = $2', [filename, id]);
      }
      saved += 1;
    } catch (err) {
      // pula fotos inválidas, mas continua as demais
      console.error('Erro ao salvar foto:', err.message);
    }
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, saved }));
}

export async function projectPhotoDelete(req, res, id, photoId) {
  const photo = await Q.getPhoto(photoId);
  if (photo) {
    await deletePhotoFiles(photo.filename, photo.thumb_filename);
    await Q.deletePhoto(photoId);
    if (photo.is_cover) {
      const next = await queryOne('SELECT * FROM photos WHERE project_id = $1 ORDER BY sort_order ASC LIMIT 1', [id]);
      if (next) {
        await query('UPDATE photos SET is_cover = 1 WHERE id = $1', [next.id]);
        await query('UPDATE projects SET cover_photo = $1 WHERE id = $2', [next.filename, id]);
      } else {
        await query('UPDATE projects SET cover_photo = $1 WHERE id = $2', ['', id]);
      }
    }
  }
  redirect(res, `/admin/projetos/${id}/fotos`);
}

export async function projectPhotoSetCover(req, res, id, photoId) {
  await Q.setPhotoAsCover(id, photoId);
  redirect(res, `/admin/projetos/${id}/fotos`);
}

export async function projectPhotoCaption(req, res, body, id, photoId) {
  await Q.setPhotoCaption(photoId, body.caption || '');
  redirect(res, `/admin/projetos/${id}/fotos`);
}

export async function projectPhotoMove(req, res, body, id, photoId) {
  const project = await Q.getProject(id);
  if (!project) return redirect(res, '/admin/projetos');
  const photos = project.photos;
  const idx = photos.findIndex((p) => p.id === photoId);
  if (idx === -1) return redirect(res, `/admin/projetos/${id}/fotos`);
  const swapWith = body.dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= photos.length) return redirect(res, `/admin/projetos/${id}/fotos`);
  const a = photos[idx], b = photos[swapWith];
  await Q.setPhotoOrder(a.id, b.sort_order);
  await Q.setPhotoOrder(b.id, a.sort_order);
  redirect(res, `/admin/projetos/${id}/fotos`);
}

// ---------------- Recuperação de acesso ----------------

export async function recoverPage(req, res) {
  const flash = readFlash(req);
  res.end(
    loginLayout({
      title: 'Recuperar acesso',
      content: `<h1>Recuperar acesso</h1><p class="sub">Use a chave de recuperação para definir um novo e-mail e senha de administrador.</p>${flash ? `<div class="admin-flash admin-flash-${escapeHtml(flash.type)}" style="margin:0 0 18px;">${escapeHtml(flash.message)}</div>` : ''}<form method="post" action="/admin/recuperar-senha">${field({ label: 'Chave de recuperação', name: 'recovery_key', type: 'password', required: true })}${field({ label: 'Novo e-mail', name: 'email', type: 'email', required: true })}${field({ label: 'Nova senha', name: 'password', type: 'password', required: true, help: 'Use pelo menos 8 caracteres.' })}<div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Salvar novo acesso</button></div></form><p class="sub" style="margin-top:18px;"><a href="/admin/login">Voltar para o login</a></p>`,
    })
  );
}

export async function recoverSubmit(req, res, body) {
  const key = process.env.ADMIN_RECOVERY_KEY;
  if (!key) return redirect(res, '/admin/recuperar-senha' + withFlash(res, 'error', 'Recuperação não configurada neste site.'));
  if (!body.recovery_key || !timingSafeStringEqual(body.recovery_key, key)) {
    return redirect(res, '/admin/recuperar-senha' + withFlash(res, 'error', 'Chave de recuperação incorreta.'));
  }
  const email = String(body.email || '').toLowerCase().trim();
  const password = String(body.password || '');
  if (!email || password.length < 8) {
    return redirect(res, '/admin/recuperar-senha' + withFlash(res, 'error', 'Preencha e-mail e uma senha com pelo menos 8 caracteres.'));
  }
  const existing = await findAdminByEmail(email);
  if (existing) {
    const { hash, salt } = hashPassword(password);
    await query('UPDATE admin_users SET password_hash = $1, salt = $2 WHERE id = $3', [hash, salt, existing.id]);
  } else {
    await createAdminUser({ email, password, name: 'Administrador' });
  }
  return redirect(res, '/admin/login' + withFlash(res, 'success', 'Acesso atualizado! Entre com o novo e-mail e senha.'));
}
