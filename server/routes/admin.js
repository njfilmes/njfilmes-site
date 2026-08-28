import { adminLayout, loginLayout, field, checkboxField, selectField } from '../adminRender.js';
import { escapeHtml } from '../util.js';
import { parseVideoUrl, videoEmbedHtml, uniqueSlug, formatDatePtBr } from '../util.js';
import { db } from '../db.js';
import {
  createAdminUser,
  findAdminByEmail,
  verifyPassword,
  hashPassword,
  createSession,
  destroySession,
  countAdmins,
} from '../auth.js';
import { saveProjectPhoto, saveMiscImage, deletePhotoFiles } from '../upload.js';
import * as Q from '../queries.js';

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
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
  return { type: raw.slice(0, idx), message: decodeURIComponent(raw.slice(idx + 1)) };
}

// ---------------- Setup / Login ----------------

export function setupPage(req, res) {
  if (countAdmins() > 0) return redirect(res, '/admin/login');
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
  if (countAdmins() > 0) return redirect(res, '/admin/login');
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
  const id = createAdminUser({ email, password, name });
  const session = createSession(id);
  const { setSessionCookie } = await import('../auth.js');
  setSessionCookie(res, session.id, session.expires);
  redirect(res, '/admin');
}

export function loginPage(req, res) {
  if (countAdmins() === 0) return redirect(res, '/admin/setup');
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
  const admin = findAdminByEmail(email || '');
  if (!admin || !verifyPassword(password || '', admin.password_hash, admin.salt)) {
    return redirect(res, '/admin/login?erro=1');
  }
  const session = createSession(admin.id);
  const { setSessionCookie } = await import('../auth.js');
  setSessionCookie(res, session.id, session.expires);
  redirect(res, '/admin');
}

export async function logoutSubmit(req, res, sessionId) {
  const { clearSessionCookie } = await import('../auth.js');
  destroySession(sessionId);
  clearSessionCookie(res);
  redirect(res, '/admin/login');
}

// ---------------- Dashboard ----------------

export function dashboardPage(req, res, admin) {
  const flash = readFlash(req);
  const totalProjects = Q.countProjects();
  const published = Q.countProjects({ onlyPublished: true });
  const draft = totalProjects - published;
  const totalPhotos = Q.countPhotos();
  const totalCats = Q.countCategories();

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
    </div>
  </div>
  <div class="panel">
    <h2>Últimos projetos</h2>
    ${renderProjectsTable(Q.listAllProjectsForAdmin().slice(0, 6))}
  </div>`;

  res.end(adminLayout({ title: 'Dashboard', activePath: '/admin', admin, content, flash }));
}

// ---------------- Categorias ----------------

export function categoriesPage(req, res, admin) {
  const flash = readFlash(req);
  const categories = Q.listCategories();
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
        <form method="post" action="/admin/categorias/${c.id}/excluir" data-confirm="Excluir a categoria \\"${c.name}\\"? Os projetos dela ficam sem categoria."><button class="btn-a btn-a-sm btn-a-danger" type="submit">Excluir</button></form>
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

export function categoryEditPage(req, res, admin, id) {
  const category = Q.getCategory(id);
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
  const slug = await Q_uniqueSlugCategory(name);
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM categories').get().m;
  Q.createCategory({ name, slug, sort_order: maxOrder + 1 });
  redirect(res, '/admin/categorias' + withFlash(res, 'success', 'Categoria criada.'));
}

async function Q_uniqueSlugCategory(name, ignoreId = null) {
  return uniqueSlug(db, 'categories', name, ignoreId);
}

export async function categoryUpdate(req, res, body, id) {
  const category = Q.getCategory(id);
  if (!category) return redirect(res, '/admin/categorias');
  const name = (body.name || category.name).trim();
  const slug = (body.slug || '').trim() || (await Q_uniqueSlugCategory(name, id));
  Q.updateCategory(id, { name, slug, sort_order: category.sort_order });
  redirect(res, '/admin/categorias');
}

export function categoryDelete(req, res, id) {
  Q.deleteCategory(id);
  redirect(res, '/admin/categorias' + withFlash(res, 'success', 'Categoria excluída.'));
}

export function categoryMove(req, res, body, id) {
  const cats = Q.listCategories();
  const idx = cats.findIndex((c) => c.id === id);
  if (idx === -1) return redirect(res, '/admin/categorias');
  const swapWith = body.dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= cats.length) return redirect(res, '/admin/categorias');
  const a = cats[idx];
  const b = cats[swapWith];
  db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?').run(b.sort_order, a.id);
  db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?').run(a.sort_order, b.id);
  redirect(res, '/admin/categorias');
}

// ---------------- Serviços ----------------

export function servicesPage(req, res, admin) {
  const flash = readFlash(req);
  const services = Q.listServices();
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
        <form method="post" action="/admin/servicos/${s.id}/excluir" data-confirm="Excluir o serviço \\"${s.title}\\"?"><button class="btn-a btn-a-sm btn-a-danger" type="submit">Excluir</button></form>
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

export function serviceEditPage(req, res, admin, id) {
  const service = Q.getService(id);
  if (!service) return redirect(res, '/admin/servicos');
  const content = `<div class="panel"><h2>Editar serviço</h2>${serviceForm({ action: `/admin/servicos/${id}/atualizar`, service })}</div>`;
  res.end(adminLayout({ title: 'Editar serviço', activePath: '/admin/servicos', admin, content }));
}

export async function serviceCreate(req, res, body) {
  let image = '';
  if (body.image_data) {
    try { image = await saveMiscImage(body.image_data); } catch { /* ignora imagem inválida */ }
  }
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM services').get().m;
  Q.createService({ title: body.title, description: body.description, image, sort_order: maxOrder + 1, published: !!body.published });
  redirect(res, '/admin/servicos' + withFlash(res, 'success', 'Serviço criado.'));
}

export async function serviceUpdate(req, res, body, id) {
  const service = Q.getService(id);
  if (!service) return redirect(res, '/admin/servicos');
  let image = body.image_existing || service.image;
  if (body.image_data) {
    try { image = await saveMiscImage(body.image_data); } catch { /* mantém imagem anterior */ }
  }
  Q.updateService(id, { title: body.title, description: body.description, image, sort_order: service.sort_order, published: !!body.published });
  redirect(res, '/admin/servicos');
}

export function serviceDelete(req, res, id) {
  Q.deleteService(id);
  redirect(res, '/admin/servicos' + withFlash(res, 'success', 'Serviço excluído.'));
}

export function serviceMove(req, res, body, id) {
  const items = Q.listServices();
  const idx = items.findIndex((s) => s.id === id);
  if (idx === -1) return redirect(res, '/admin/servicos');
  const swapWith = body.dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= items.length) return redirect(res, '/admin/servicos');
  const a = items[idx], b = items[swapWith];
  db.prepare('UPDATE services SET sort_order = ? WHERE id = ?').run(b.sort_order, a.id);
  db.prepare('UPDATE services SET sort_order = ? WHERE id = ?').run(a.sort_order, b.id);
  redirect(res, '/admin/servicos');
}

// ---------------- Marcas (clientes) ----------------

export function brandsPage(req, res, admin) {
  const flash = readFlash(req);
  const brands = Q.listBrands();
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
        <form method="post" action="/admin/marcas/${b.id}/excluir" data-confirm="Excluir a marca \\"${b.name}\\"?"><button class="btn-a btn-a-sm btn-a-danger" type="submit">Excluir</button></form>
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

export function brandEditPage(req, res, admin, id) {
  const brand = Q.getBrand(id);
  if (!brand) return redirect(res, '/admin/marcas');
  const content = `<div class="panel"><h2>Editar marca</h2>${brandForm({ action: `/admin/marcas/${id}/atualizar`, brand })}</div>`;
  res.end(adminLayout({ title: 'Editar marca', activePath: '/admin/marcas', admin, content }));
}

export async function brandCreate(req, res, body) {
  if (!body.logo_data) return redirect(res, '/admin/marcas' + withFlash(res, 'error', 'Envie uma imagem de logo.'));
  let logo;
  try { logo = await saveMiscImage(body.logo_data); } catch (e) { return redirect(res, '/admin/marcas' + withFlash(res, 'error', e.message)); }
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM brands').get().m;
  Q.createBrand({ name: body.name, logo, url: body.url, sort_order: maxOrder + 1 });
  redirect(res, '/admin/marcas' + withFlash(res, 'success', 'Marca adicionada.'));
}

export async function brandUpdate(req, res, body, id) {
  const brand = Q.getBrand(id);
  if (!brand) return redirect(res, '/admin/marcas');
  let logo = body.logo_existing || brand.logo;
  if (body.logo_data) {
    try { logo = await saveMiscImage(body.logo_data); } catch { /* mantém logo anterior */ }
  }
  Q.updateBrand(id, { name: body.name, logo, url: body.url, sort_order: brand.sort_order });
  redirect(res, '/admin/marcas');
}

export function brandDelete(req, res, id) {
  Q.deleteBrand(id);
  redirect(res, '/admin/marcas' + withFlash(res, 'success', 'Marca excluída.'));
}

export function brandMove(req, res, body, id) {
  const items = Q.listBrands();
  const idx = items.findIndex((b) => b.id === id);
  if (idx === -1) return redirect(res, '/admin/marcas');
  const swapWith = body.dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= items.length) return redirect(res, '/admin/marcas');
  const a = items[idx], b = items[swapWith];
  db.prepare('UPDATE brands SET sort_order = ? WHERE id = ?').run(b.sort_order, a.id);
  db.prepare('UPDATE brands SET sort_order = ? WHERE id = ?').run(a.sort_order, b.id);
  redirect(res, '/admin/marcas');
}

// ---------------- Pessoas ----------------

export function peoplePage(req, res, admin) {
  const flash = readFlash(req);
  const people = Q.listPeople();
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
        <form method="post" action="/admin/pessoas/${p.id}/excluir" data-confirm="Excluir \\"${p.name}\\"?"><button class="btn-a btn-a-sm btn-a-danger" type="submit">Excluir</button></form>
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

export function personEditPage(req, res, admin, id) {
  const person = Q.getPerson(id);
  if (!person) return redirect(res, '/admin/pessoas');
  const content = `<div class="panel"><h2>Editar pessoa</h2>${personForm({ action: `/admin/pessoas/${id}/atualizar`, person })}</div>`;
  res.end(adminLayout({ title: 'Editar pessoa', activePath: '/admin/pessoas', admin, content }));
}

export async function personCreate(req, res, body) {
  if (!body.photo_data) return redirect(res, '/admin/pessoas' + withFlash(res, 'error', 'Envie uma foto.'));
  let photo;
  try { photo = await saveMiscImage(body.photo_data); } catch (e) { return redirect(res, '/admin/pessoas' + withFlash(res, 'error', e.message)); }
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM people').get().m;
  Q.createPerson({ name: body.name, role: body.role, photo, sort_order: maxOrder + 1 });
  redirect(res, '/admin/pessoas' + withFlash(res, 'success', 'Pessoa adicionada.'));
}

export async function personUpdate(req, res, body, id) {
  const person = Q.getPerson(id);
  if (!person) return redirect(res, '/admin/pessoas');
  let photo = body.photo_existing || person.photo;
  if (body.photo_data) {
    try { photo = await saveMiscImage(body.photo_data); } catch { /* mantém foto anterior */ }
  }
  Q.updatePerson(id, { name: body.name, role: body.role, photo, sort_order: person.sort_order });
  redirect(res, '/admin/pessoas');
}

export function personDelete(req, res, id) {
  Q.deletePerson(id);
  redirect(res, '/admin/pessoas' + withFlash(res, 'success', 'Pessoa excluída.'));
}

export function personMove(req, res, body, id) {
  const items = Q.listPeople();
  const idx = items.findIndex((p) => p.id === id);
  if (idx === -1) return redirect(res, '/admin/pessoas');
  const swapWith = body.dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= items.length) return redirect(res, '/admin/pessoas');
  const a = items[idx], b = items[swapWith];
  db.prepare('UPDATE people SET sort_order = ? WHERE id = ?').run(b.sort_order, a.id);
  db.prepare('UPDATE people SET sort_order = ? WHERE id = ?').run(a.sort_order, b.id);
  redirect(res, '/admin/pessoas');
}

// ---------------- Links externos ----------------

export function linksPage(req, res, admin) {
  const flash = readFlash(req);
  const links = Q.listLinks();
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
        <form method="post" action="/admin/links/${l.id}/excluir" data-confirm="Excluir o link \\"${l.name}\\"?"><button class="btn-a btn-a-sm btn-a-danger" type="submit">Excluir</button></form>
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

export function linkCreate(req, res, body) {
  if (!body.name || !body.url) return redirect(res, '/admin/links');
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM links').get().m;
  Q.createLink({ name: body.name, url: body.url, sort_order: maxOrder + 1 });
  redirect(res, '/admin/links' + withFlash(res, 'success', 'Link adicionado.'));
}

export function linkDelete(req, res, id) {
  Q.deleteLink(id);
  redirect(res, '/admin/links' + withFlash(res, 'success', 'Link excluído.'));
}

export function linkMove(req, res, body, id) {
  const items = Q.listLinks();
  const idx = items.findIndex((l) => l.id === id);
  if (idx === -1) return redirect(res, '/admin/links');
  const swapWith = body.dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= items.length) return redirect(res, '/admin/links');
  const a = items[idx], b = items[swapWith];
  db.prepare('UPDATE links SET sort_order = ? WHERE id = ?').run(b.sort_order, a.id);
  db.prepare('UPDATE links SET sort_order = ? WHERE id = ?').run(a.sort_order, b.id);
  redirect(res, '/admin/links');
}

// ---------------- Biografia ----------------

export function bioPage(req, res, admin) {
  const flash = readFlash(req);
  const bio = Q.getBio();
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
      <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Salvar biografia</button></div>
    </form>
  </div>`;
  res.end(adminLayout({ title: 'Biografia / Sobre', activePath: '/admin/bio', admin, content, flash }));
}

export async function bioUpdate(req, res, body) {
  const bio = Q.getBio();
  let profile_photo = bio.profile_photo;
  if (body.profile_photo_data) {
    try { profile_photo = await saveMiscImage(body.profile_photo_data); } catch { /* mantém foto anterior */ }
  }
  Q.updateBio({
    name: body.name || '',
    professional_title: body.professional_title || '',
    biography: body.biography || '',
    trajectory: body.trajectory || '',
    specialties: body.specialties || '',
    equipment: body.equipment || '',
    profile_photo,
    cta_text: body.cta_text || '',
  });
  redirect(res, '/admin/bio' + withFlash(res, 'success', 'Biografia atualizada.'));
}

// ---------------- Configurações ----------------

export function settingsPage(req, res, admin) {
  const flash = readFlash(req);
  const s = Q.getSettings();
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
      ${field({ label: 'Título para o Google (meta title)', name: 'meta_title', value: s.meta_title })}
      ${field({ label: 'Descrição para o Google (meta description)', name: 'meta_description', value: s.meta_description, textarea: true, rows: 2 })}
      ${field({ label: 'Texto do rodapé', name: 'footer_text', value: s.footer_text })}
      <h2 style="margin-top:32px;">WhatsApp</h2>
      ${field({ label: 'Número do WhatsApp', name: 'whatsapp_number', value: s.whatsapp_number, placeholder: 'Ex: 5571986817816 (DDI+DDD+número, só números)' })}
      ${field({ label: 'Mensagem automática', name: 'whatsapp_message', value: s.whatsapp_message, textarea: true, rows: 2 })}
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

export function changePasswordSubmit(req, res, body, admin) {
  const { current_password, new_password, confirm_password } = body;
  const fresh = findAdminByEmail(admin.email);
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
  db.prepare('UPDATE admin_users SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, fresh.id);
  redirect(res, '/admin/configuracoes' + withFlash(res, 'success', 'Senha alterada com sucesso.'));
}

export function settingsUpdate(req, res, body) {
  Q.updateSettings({
    site_name: body.site_name || 'NJFILMES',
    tagline: body.tagline || '',
    hero_headline: body.hero_headline || '',
    hero_subheadline: body.hero_subheadline || '',
    hero_video_url: body.hero_video_url || '',
    meta_title: body.meta_title || '',
    meta_description: body.meta_description || '',
    footer_text: body.footer_text || '',
    whatsapp_number: body.whatsapp_number || '',
    whatsapp_message: body.whatsapp_message || '',
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
      <td>${p.published ? '<span class="tag tag-published">Publicado</span>' : '<span class="tag tag-draft">Rascunho</span>'} ${p.featured ? '<span class="tag tag-featured">Destaque</span>' : ''}</td>
      <td class="row-actions">
        <a class="btn-a btn-a-sm" href="/admin/projetos/${p.id}">Editar</a>
        <form method="post" action="/admin/projetos/${p.id}/excluir" data-confirm="Excluir o projeto \\"${p.title}\\"? Isso remove também as fotos e vídeos dele."><button class="btn-a btn-a-sm btn-a-danger" type="submit">Excluir</button></form>
      </td>
    </tr>`
    )
    .join('');
  return `<table class="admin-table"><thead><tr><th>Capa</th><th>Título</th><th>Categoria</th><th>Status</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function projectsListPage(req, res, admin) {
  const flash = readFlash(req);
  const projects = Q.listAllProjectsForAdmin();
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
    <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Salvar</button></div>
  </form>`;
}

export function projectNewPage(req, res, admin) {
  const categories = Q.listCategories();
  const content = `<div class="panel"><h2>Novo projeto</h2>${projectInfoForm({ action: '/admin/projetos/criar', categories })}</div>`;
  res.end(adminLayout({ title: 'Novo projeto', activePath: '/admin/projetos', admin, content }));
}

export async function projectCreate(req, res, body) {
  const title = (body.title || '').trim();
  if (!title) return redirect(res, '/admin/projetos/novo');
  const slug = (body.slug || '').trim() ? await uniqueSlug(db, 'projects', body.slug) : await uniqueSlug(db, 'projects', title);
  const id = Q.createProject({
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

export function projectEditPage(req, res, admin, id, tab = 'info') {
  const project = Q.getProject(id);
  if (!project) return redirect(res, '/admin/projetos');
  const flash = readFlash(req);
  const categories = Q.listCategories();

  let body;
  if (tab === 'videos') {
    body = `
    ${projectTabs(id, 'videos')}
    <div class="panel">
      <h2>Adicionar vídeo</h2>
      <p class="muted" style="margin-top:-8px;">Cole o link do YouTube, Vimeo, ou de um vídeo hospedado externamente (.mp4). O sistema identifica e incorpora automaticamente.</p>
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
      <form method="post" action="/admin/projetos/${id}/excluir" data-confirm="Excluir o projeto \\"${project.title}\\" e todo o seu conteúdo?"><button class="btn-a btn-a-danger" type="submit">Excluir projeto</button></form>
    </div>`;
  }

  res.end(adminLayout({ title: project.title, activePath: '/admin/projetos', admin, content: body, flash }));
}

export async function projectUpdate(req, res, body, id) {
  const project = Q.getProject(id);
  if (!project) return redirect(res, '/admin/projetos');
  const title = (body.title || project.title).trim();
  const slug = (body.slug || '').trim() ? await uniqueSlug(db, 'projects', body.slug, id) : project.slug;
  Q.updateProject(id, {
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
    sort_order: project.sort_order,
  });
  redirect(res, `/admin/projetos/${id}` + withFlash(res, 'success', 'Projeto atualizado.'));
}

export function projectDelete(req, res, id) {
  Q.deleteProject(id);
  redirect(res, '/admin/projetos' + withFlash(res, 'success', 'Projeto excluído.'));
}

export function projectVideoCreate(req, res, body, id) {
  const parsed = parseVideoUrl(body.url);
  if (!parsed) return redirect(res, `/admin/projetos/${id}/videos` + withFlash(res, 'error', 'Link de vídeo inválido.'));
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM project_videos WHERE project_id = ?').get(id).m;
  Q.addProjectVideo(id, { provider: parsed.provider, video_id: parsed.videoId, url: parsed.url, title: body.title, sort_order: maxOrder + 1 });
  redirect(res, `/admin/projetos/${id}/videos` + withFlash(res, 'success', 'Vídeo adicionado.'));
}

export function projectVideoDelete(req, res, id, videoId) {
  Q.deleteProjectVideo(videoId);
  redirect(res, `/admin/projetos/${id}/videos`);
}

export async function projectPhotosUpload(req, res, body, id) {
  const project = Q.getProject(id);
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
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM photos WHERE project_id = ?').get(id).m;
  let order = maxOrder;
  let saved = 0;
  const isFirstBatch = project.photos.length === 0;
  for (const dataUrl of photos) {
    try {
      const { filename, thumbFilename } = await saveProjectPhoto(dataUrl);
      order += 1;
      const photoId = Q.addPhoto(id, { filename, thumbFilename, sort_order: order, is_cover: isFirstBatch && saved === 0 ? 1 : 0 });
      if (isFirstBatch && saved === 0) {
        db.prepare('UPDATE projects SET cover_photo = ? WHERE id = ?').run(filename, id);
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
  const photo = Q.getPhoto(photoId);
  if (photo) {
    await deletePhotoFiles(photo.filename, photo.thumb_filename);
    Q.deletePhoto(photoId);
    if (photo.is_cover) {
      const next = db.prepare('SELECT * FROM photos WHERE project_id = ? ORDER BY sort_order ASC LIMIT 1').get(id);
      if (next) {
        db.prepare('UPDATE photos SET is_cover = 1 WHERE id = ?').run(next.id);
        db.prepare('UPDATE projects SET cover_photo = ? WHERE id = ?').run(next.filename, id);
      } else {
        db.prepare('UPDATE projects SET cover_photo = ? WHERE id = ?').run('', id);
      }
    }
  }
  redirect(res, `/admin/projetos/${id}/fotos`);
}

export function projectPhotoSetCover(req, res, id, photoId) {
  Q.setPhotoAsCover(id, photoId);
  redirect(res, `/admin/projetos/${id}/fotos`);
}

export function projectPhotoCaption(req, res, body, id, photoId) {
  Q.setPhotoCaption(photoId, body.caption || '');
  redirect(res, `/admin/projetos/${id}/fotos`);
}

export function projectPhotoMove(req, res, body, id, photoId) {
  const photos = Q.getProject(id).photos;
  const idx = photos.findIndex((p) => p.id === photoId);
  if (idx === -1) return redirect(res, `/admin/projetos/${id}/fotos`);
  const swapWith = body.dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= photos.length) return redirect(res, `/admin/projetos/${id}/fotos`);
  const a = photos[idx], b = photos[swapWith];
  Q.setPhotoOrder(a.id, b.sort_order);
  Q.setPhotoOrder(b.id, a.sort_order);
  redirect(res, `/admin/projetos/${id}/fotos`);
}
