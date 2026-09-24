import crypto from 'node:crypto';
import { adminLayout, loginLayout, field, checkboxField, selectField } from '../adminRender.js';
import { escapeHtml } from '../util.js';
import { parseVideoUrl, videoEmbedHtml, uniqueSlug, formatDatePtBr, formatDateTimePtBr } from '../util.js';
import { query, queryOne } from '../db.js';
import { absoluteUrl } from '../render.js';
import { sendEmail } from '../mailer.js';
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
  loginGuard,
  recoveryGuard,
  resetRequestGuard,
  resetTokenGuard,
  createPasswordResetToken,
  checkPasswordResetToken,
  consumePasswordResetToken,
  getClientIp,
} from '../auth.js';
import {
  saveProjectPhoto,
  saveMiscImage,
  saveVideoFile,
  deletePhotoFiles,
  saveDeliveryPhoto,
  deleteDeliveryPhotoFiles,
  saveDeliveryVideoFile,
  deleteDeliveryVideoFile,
  saveSelectionPhoto,
  deleteSelectionPhotoFiles,
} from '../upload.js';
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

// Igual maxSortOrder, mas olhando fotos E vídeos de uma entrega juntos — pedido do usuário em
// 17/09/2026 pra poder "intercalar" foto e vídeo na rolagem da página de entrega (ver
// server/deliveryPage.js), em vez de sempre mostrar todos os vídeos primeiro e todas as fotos
// depois. Usando essa mesma numeração combinada como base pra sort_order de fotos e vídeos, a
// ordem que aparece na página acaba sendo simplesmente a ordem em que cada foto/vídeo foi
// adicionado no painel — se o usuário sobe 2 fotos, cola um vídeo, e sobe mais fotos, é assim
// que aparece na rolagem, misturado.
async function maxCombinedDeliverySortOrder(caseId) {
  const [photoMax, videoMax] = await Promise.all([
    maxSortOrder('delivery_photos', 'case_id', caseId),
    maxSortOrder('delivery_videos', 'case_id', caseId),
  ]);
  return Math.max(photoMax, videoMax);
}

// Junta fotos e vídeos numa lista só, na mesma ordem em que aparecem pro cliente na página de
// entrega (server/deliveryPage.js faz o mesmo merge) — usada pra mostrar "posição X de N" no
// painel e pra mover foto/vídeo de posição entre si (17/09/2026: antes só dava pra mover foto
// entre fotos e vídeo não tinha nem seta — o usuário perguntou "como vou saber a ordem do vídeo
// e das fotos" já que agora eles se intercalam na entrega).
function combinedDeliveryMedia(deliveryCase) {
  return [
    ...(deliveryCase.videos || []).map((v) => ({ kind: 'video', id: v.id, sortOrder: Number(v.sort_order) || 0 })),
    ...(deliveryCase.photos || []).map((p) => ({ kind: 'foto', id: p.id, sortOrder: Number(p.sort_order) || 0 })),
  ].sort((a, b) => (a.sortOrder - b.sortOrder) || (a.id - b.id));
}

export async function deliveryMediaMove(req, res, body, id, kind, mediaId) {
  const deliveryCase = await Q.getDeliveryCase(id);
  if (!deliveryCase) return redirect(res, '/admin/entregas');
  const items = combinedDeliveryMedia(deliveryCase);
  const idx = items.findIndex((it) => it.kind === kind && it.id === mediaId);
  const backTo = `/admin/entregas/${id}/${kind === 'video' ? 'videos' : 'fotos'}`;
  if (idx === -1) return redirect(res, backTo);
  const swapWith = body.dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= items.length) return redirect(res, backTo);
  const a = items[idx], b = items[swapWith];
  const setOrder = (it, sortOrder) => (it.kind === 'video' ? Q.setDeliveryVideoOrder(it.id, sortOrder) : Q.setDeliveryPhotoOrder(it.id, sortOrder));
  await setOrder(a, b.sortOrder);
  await setOrder(b, a.sortOrder);
  redirect(res, backTo);
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
  // "bloqueado" é um erro distinto de "1" (credenciais erradas) — ver loginGuard em
  // server/auth.js, adicionado em 04/09/2026 pra deixar claro pro usuário que não é a senha que
  // está errada, é que ele (ou um script tentando adivinhar a senha) errou demais e precisa
  // esperar um pouco.
  let errorHtml = '';
  if (error === 'bloqueado') {
    errorHtml = `<div class="admin-flash admin-flash-error" style="margin:0 0 18px;">Muitas tentativas com senha incorreta. Tente novamente em alguns minutos.</div>`;
  } else if (error) {
    errorHtml = `<div class="admin-flash admin-flash-error" style="margin:0 0 18px;">E-mail ou senha inválidos.</div>`;
  }
  res.end(
    loginLayout({
      title: 'Entrar',
      content: `
      <h1>Painel administrativo</h1>
      <p class="sub">Entre com seu e-mail e senha para gerenciar o site.</p>
      ${errorHtml}
      <form method="post" action="/admin/login">
        ${field({ label: 'E-mail', name: 'email', type: 'email', required: true })}
        ${field({ label: 'Senha', name: 'password', type: 'password', required: true })}
        <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Entrar</button></div>
      </form>
      <!-- Pedido do usuário (18/09/2026): a recuperação de acesso em /admin/recuperar-senha já
      existia (protegida pela chave ADMIN_RECOVERY_KEY no Render), mas não tinha nenhum link pra
      ela na tela de login - então na prática ninguém achava. Depois, no mesmo dia, o usuário
      preferiu recuperação por e-mail em vez de precisar da chave fixa - então o link aqui aponta
      pro fluxo novo (/admin/esqueci-senha); o antigo continua funcionando, só ficou sem link,
      como reserva pra caso o e-mail não esteja configurado ou não chegue.
      -->
      <p class="sub" style="margin-top:18px;text-align:center;"><a href="/admin/esqueci-senha">Esqueci minha senha</a></p>`,
    })
  );
}

export async function loginSubmit(req, res, body) {
  const ip = getClientIp(req);
  // Bloqueia por IP depois de várias tentativas erradas seguidas — ver loginGuard em
  // server/auth.js (adicionado em 04/09/2026). Antes disso não havia nenhum limite de tentativas.
  if (loginGuard.isBlocked(ip)) {
    return redirect(res, '/admin/login?erro=bloqueado');
  }
  const { email, password } = body;
  const admin = await findAdminByEmail(email || '');
  if (!admin || !verifyPassword(password || '', admin.password_hash, admin.salt)) {
    loginGuard.registerFailure(ip);
    return redirect(res, '/admin/login?erro=1');
  }
  loginGuard.registerSuccess(ip);
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

// Pedido interno (não do usuário) em 04/09/2026: antes disso, salvar algo no painel só
// confirmava que gravou no banco de dados — não tinha nenhum jeito de saber, olhando o painel,
// se a publicação do site (que acontece à parte, na Render) realmente aconteceu. Esse aviso
// mostra a última tentativa registrada (ver server/deployHook.js). Importante: "sucesso" aqui
// quer dizer que o pedido de publicação foi disparado e aceito - a publicação em si ainda leva
// alguns minutos rodando na Render depois disso, então mesmo com esse aviso verde vale conferir
// o site no ar se a mudança for importante.
function renderPublishStatus(status) {
  if (!status) {
    return `<div class="panel"><h2>Última publicação do site</h2><p class="sub">Nenhuma publicação foi registrada ainda nesta versão do painel.</p></div>`;
  }
  let parsed = null;
  try { parsed = JSON.parse(status.value); } catch { /* formato inesperado, trata como ausente */ }
  if (!parsed) {
    return `<div class="panel"><h2>Última publicação do site</h2><p class="sub">Não foi possível ler o status da última publicação.</p></div>`;
  }
  const when = formatDateTimePtBr(parsed.at || status.updated_at);
  if (parsed.ok) {
    return `<div class="panel"><h2>Última publicação do site</h2><p class="sub" style="color:#3a9a5c;">✓ Publicação disparada com sucesso em ${when}. O site pode levar alguns minutos pra terminar de atualizar.</p></div>`;
  }
  return `<div class="panel"><h2>Última publicação do site</h2><p class="sub" style="color:#d0503a;">✗ A última tentativa de publicação (${when}) falhou: ${escapeHtml(parsed.detail || 'motivo não registrado')}. As mudanças que você salvou estão seguras no banco de dados, mas podem não estar aparecendo no site ainda — fale com quem cuida do site técnico.</p></div>`;
}

export async function dashboardPage(req, res, admin) {
  const flash = readFlash(req);
  const totalProjects = await Q.countProjects();
  const published = await Q.countProjects({ onlyPublished: true });
  const draft = totalProjects - published;
  const totalPhotos = await Q.countPhotos();
  const totalCats = await Q.countCategories();
  const recentProjects = (await Q.listAllProjectsForAdmin()).slice(0, 6);
  const publishStatus = await Q.getAppStatus('static_rebuild');

  const content = `
  <div class="stat-cards">
    <div class="stat-card"><b>${totalProjects}</b><span>Projetos</span></div>
    <div class="stat-card"><b>${published}</b><span>Publicados</span></div>
    <div class="stat-card"><b>${draft}</b><span>Rascunhos</span></div>
    <div class="stat-card"><b>${totalPhotos}</b><span>Fotos</span></div>
    <div class="stat-card"><b>${totalCats}</b><span>Categorias</span></div>
  </div>
  ${renderPublishStatus(publishStatus)}
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
  const projects = await Q.listProjects();
  const projectOptions = projects.map((p) => ({ value: p.id, label: p.title }));
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
    <p class="muted" style="margin-top:-8px;">Comentários deixados por visitantes nas páginas dos projetos (fotos e vídeos). Você pode responder publicamente, excluir comentários indesejados ou escrever um comentário você mesmo.</p>
  </div>
  <div class="panel">
    <h3>Escrever um novo comentário</h3>
    <p class="muted" style="margin-top:-8px;">Aparece na página do projeto igual a um comentário de visitante — use pra destacar um feedback de cliente que você recebeu por fora (WhatsApp, etc.) ou pra puxar a conversa num projeto novo.</p>
    ${projects.length ? `<form method="post" action="/admin/comentarios/adicionar">
      ${selectField({ label: 'Projeto', name: 'project_id', options: projectOptions, help: 'Em qual trabalho esse comentário vai aparecer.' })}
      ${field({ label: 'Nome (quem está comentando)', name: 'author_name', value: 'NJFILMES', placeholder: 'Ex: NJFILMES, ou o nome do cliente' })}
      ${field({ label: 'Comentário', name: 'content', textarea: true, rows: 3, placeholder: 'Escreva o comentário...' })}
      <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Publicar comentário</button></div>
    </form>` : '<p class="empty-hint">Crie um projeto primeiro para poder comentar nele.</p>'}
  </div>
  ${comments.length ? rows : '<div class="panel"><p class="empty-hint">Nenhum comentário ainda.</p></div>'}`;
  res.end(adminLayout({ title: 'Comentários', activePath: '/admin/comentarios', admin, content, flash }));
}

// Rota usa "/adicionar" (não "/criar") de propósito: comentários são carregados dinamicamente
// pelo site (fetch no navegador, ver public/js/site.js) e não ficam gravados no HTML publicado,
// então escrever um aqui não precisa disparar a republicação do site estático - ver o regex em
// server/index.js que decide quando chamar triggerStaticRebuild (mesmo motivo de "responder" e
// "remover" já usarem nomes fora desse regex).
export async function commentCreate(req, res, body) {
  const projectId = Number(body.project_id);
  const authorName = (body.author_name || '').trim();
  const content = (body.content || '').trim();
  if (!projectId || !authorName || !content) {
    return redirect(res, '/admin/comentarios' + withFlash(res, 'error', 'Preencha o projeto, o nome e o comentário.'));
  }
  const project = await Q.getProject(projectId);
  if (!project) {
    return redirect(res, '/admin/comentarios' + withFlash(res, 'error', 'Projeto não encontrado.'));
  }
  await Q.createComment({ project_id: projectId, author_name: authorName, content });
  redirect(res, '/admin/comentarios' + withFlash(res, 'success', 'Comentário publicado.'));
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
  const bioVideos = await Q.listBioVideos();
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
      <h2 style="margin-top:32px;">Textos da página Sobre</h2>
      <p class="muted" style="margin-top:-8px;">Títulos que apareciam fixos no código — pedido do usuário em 17/09/2026 pra deixar tudo editável por aqui. Deixando em branco, volta pro texto padrão.</p>
      <div class="form-row">
        ${field({ label: 'Legenda acima do seu nome', name: 'about_eyebrow', value: bio.about_eyebrow, placeholder: 'Sobre a NJFILMES' })}
        ${field({ label: 'Ano de fundação (mostrado em "Desde")', name: 'founded_year', value: bio.founded_year, placeholder: '2015' })}
      </div>
      <div class="form-row">
        ${field({ label: 'Estado (sigla, mostrado grande)', name: 'location_state', value: bio.location_state, placeholder: 'BA' })}
        ${field({ label: 'Cidade (mostrada embaixo do estado)', name: 'location_city', value: bio.location_city, placeholder: 'Salvador' })}
      </div>
      <div class="form-row">
        ${field({ label: 'Legenda da seção de vídeos', name: 'videos_eyebrow', value: bio.videos_eyebrow, placeholder: 'Vídeos' })}
        ${field({ label: 'Título da seção de vídeos', name: 'videos_title', value: bio.videos_title, placeholder: 'Conheça um pouco mais' })}
      </div>
      <div class="form-row">
        ${field({ label: 'Legenda da galeria de bastidores', name: 'gallery_eyebrow', value: bio.gallery_eyebrow, placeholder: 'Bastidores' })}
        ${field({ label: 'Título da galeria de bastidores', name: 'gallery_title', value: bio.gallery_title, placeholder: 'Ex: No set com a NJFILMES', help: 'Aparece acima da faixa de fotos "Bastidores", na página Sobre.' })}
      </div>
      <div class="form-row">
        ${field({ label: 'Legenda da seção Trajetória', name: 'trajectory_eyebrow', value: bio.trajectory_eyebrow, placeholder: 'Trajetória' })}
        ${field({ label: 'Título da seção Trajetória', name: 'trajectory_title', value: bio.trajectory_title, placeholder: 'Ex: Uma jornada pela imagem', help: 'Aparece acima do texto de trajetória, na página Sobre.' })}
      </div>
      <div class="form-row">
        ${field({ label: 'Legenda da seção Equipamentos', name: 'equipment_eyebrow', value: bio.equipment_eyebrow, placeholder: 'Estrutura' })}
        ${field({ label: 'Título da seção Equipamentos', name: 'equipment_title', value: bio.equipment_title, placeholder: 'Equipamentos' })}
      </div>
      <div class="form-row">
        ${field({ label: 'Legenda da seção "Pessoas"', name: 'people_eyebrow', value: bio.people_eyebrow, placeholder: 'Quem já passou pela câmera' })}
        ${field({ label: 'Título da seção "Pessoas"', name: 'people_title', value: bio.people_title, placeholder: 'Pessoas que já trabalhei' })}
      </div>
      <div class="form-row">
        ${field({ label: 'Legenda da seção Marcas', name: 'brands_eyebrow', value: bio.brands_eyebrow, placeholder: 'Quem confia no meu trabalho' })}
        ${field({ label: 'Título da seção Marcas', name: 'brands_title', value: bio.brands_title, placeholder: 'Marcas' })}
      </div>
      ${field({ label: 'Título da seção de contato no fim da página', name: 'bottom_cta_title', value: bio.bottom_cta_title, placeholder: 'Fale agora com a NJFILMES' })}
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
    <h2>Vídeos da página Sobre</h2>
    <p class="muted" style="margin-top:-8px;">Além das fotos, você pode colocar vários vídeos (YouTube, Vimeo, Mega, Google Drive ou link direto) — eles aparecem numa seção logo abaixo da sua biografia, um do lado do outro, igual aos vídeos de um projeto.</p>
    <form method="post" action="/admin/bio/videos/criar">
      <div class="form-row">
        ${field({ label: 'URL do vídeo', name: 'url', required: true, placeholder: 'https://www.youtube.com/watch?v=...' })}
        ${field({ label: 'Título (opcional)', name: 'title', placeholder: 'Ex: Making of' })}
      </div>
      <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Adicionar vídeo</button></div>
    </form>
    ${bioVideos.length ? bioVideos.map((v) => `
      <div class="video-item">
        <div class="vi-info"><b>${escapeHtml(v.title || v.provider)}</b><span>${escapeHtml(v.url)}</span></div>
        <form method="post" action="/admin/bio/videos/${v.id}/excluir" data-confirm="Remover este vídeo?"><button class="btn-a btn-a-sm btn-a-danger">Remover</button></form>
      </div>`).join('') : '<p class="empty-hint">Nenhum vídeo adicionado ainda.</p>'}
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
    // 17/09/2026: rodada de "quero todo o site com textos editáveis" (ver server/db.js).
    about_eyebrow: body.about_eyebrow || '',
    founded_year: body.founded_year || '',
    location_city: body.location_city || '',
    location_state: body.location_state || '',
    videos_eyebrow: body.videos_eyebrow || '',
    videos_title: body.videos_title || '',
    gallery_eyebrow: body.gallery_eyebrow || '',
    trajectory_eyebrow: body.trajectory_eyebrow || '',
    equipment_eyebrow: body.equipment_eyebrow || '',
    equipment_title: body.equipment_title || '',
    people_eyebrow: body.people_eyebrow || '',
    people_title: body.people_title || '',
    brands_eyebrow: body.brands_eyebrow || '',
    brands_title: body.brands_title || '',
    bottom_cta_title: body.bottom_cta_title || '',
  });
  redirect(res, '/admin/bio' + withFlash(res, photoFailed ? 'error' : 'success', photoFailed ? 'Biografia atualizada, mas a nova foto de perfil não pôde ser salva (a antiga foi mantida).' : 'Biografia atualizada.'));
}

// Vídeos da página Sobre (além das fotos - pedido em 10/09/2026): mesmo padrão de
// projectVideoCreate/projectVideoDelete, só que sem project_id (a bio é única).
export async function bioVideoCreate(req, res, body) {
  const parsed = parseVideoUrl(body.url);
  if (!parsed) return redirect(res, '/admin/bio' + withFlash(res, 'error', 'Link de vídeo inválido.'));
  const maxOrder = await maxSortOrder('bio_videos');
  await Q.addBioVideo({ provider: parsed.provider, video_id: parsed.videoId, url: parsed.url, title: body.title, sort_order: maxOrder + 1 });
  redirect(res, '/admin/bio' + withFlash(res, 'success', 'Vídeo adicionado.'));
}

export async function bioVideoDelete(req, res, id) {
  await Q.deleteBioVideo(id);
  redirect(res, '/admin/bio' + withFlash(res, 'success', 'Vídeo removido.'));
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
      ${selectField({
        label: 'Fonte do site',
        name: 'site_font_preset',
        selected: s.site_font_preset || '',
        options: [
          { value: '', label: 'Padrão (a de sempre)' },
          { value: 'moderna', label: 'Moderna (Outfit)' },
          { value: 'impacto', label: 'Impacto (Anton)' },
          { value: 'cinema', label: 'Cinematográfica (Bebas Neue)' },
          { value: 'arredondada', label: 'Arredondada (Hanken Grotesk)' },
          { value: 'elegante', label: 'Elegante / serifada (Playfair Display + Lora)' },
          { value: 'minimalista', label: 'Minimalista (Manrope)' },
          { value: 'geometrica', label: 'Geométrica (Montserrat)' },
          { value: 'condensada', label: 'Condensada (Oswald)' },
          { value: 'tech', label: 'Tech / monoespaçada (Space Mono)' },
          { value: 'suave', label: 'Suave / arredondada 2 (Quicksand)' },
          { value: 'lato', label: 'Clássica (Lato)' },
          { value: 'nunito', label: 'Amigável (Nunito)' },
          { value: 'editorial', label: 'Editorial (Merriweather)' },
          { value: 'sofisticada', label: 'Sofisticada (Raleway)' },
          { value: 'divertida', label: 'Divertida (Rubik)' },
          { value: 'retro', label: 'Retrô elegante (Josefin Sans)' },
          { value: 'casamento', label: 'Romântica / casamento (Cormorant Garamond)' },
          { value: 'futurista', label: 'Futurista (Space Grotesk)' },
          { value: 'solida', label: 'Extra sólida (Archivo Black)' },
          { value: 'assinatura', label: 'Manuscrita / assinatura (Caveat)' },
          { value: 'moda', label: 'Editorial de moda (Bodoni Moda)' },
          { value: 'urbano', label: 'Urbana / pôster (Big Shoulders Display)' },
        ],
        help: 'Troca a fonte dos títulos das seções e do menu em todo o site. Em algumas opções (Elegante, Minimalista, Tech, Suave, Clássica, Amigável, Editorial, Divertida e Romântica/casamento) o texto corrido também muda junto, pra combinar; nas outras, o texto corrido continua no mesmo, pra manter a leitura confortável. O título grande da Home tem fonte própria, já ajustada à parte, e não muda por aqui.',
      })}
      ${selectField({
        label: 'Peso dos títulos (negrito)',
        name: 'site_font_weight',
        selected: s.site_font_weight || '',
        options: [
          { value: '', label: 'Padrão (Negrito)' },
          { value: '400', label: 'Normal (mais fina)' },
          { value: '500', label: 'Média' },
          { value: '600', label: 'Semi-negrito' },
          { value: '800', label: 'Extra-negrito (mais forte)' },
        ],
        help: 'Deixa os títulos das seções, do menu e das páginas mais finos ou mais grossos em todo o site. O título grande da Home não muda por aqui (fonte e peso próprios, já ajustados à parte).',
      })}
      ${selectField({
        label: 'Tamanho da fonte do site',
        name: 'site_font_scale',
        selected: s.site_font_scale || '',
        options: [
          { value: '', label: 'Padrão (100%)' },
          { value: '0.7', label: 'Muito menor (70%)' },
          { value: '0.75', label: 'Bem menor (75%)' },
          { value: '0.8', label: 'Menor (80%)' },
          { value: '0.85', label: 'Um pouco bem menor (85%)' },
          { value: '0.9', label: 'Menor (90%)' },
          { value: '0.95', label: 'Um pouco menor (95%)' },          
          { value: '1.05', label: 'Um pouco maior (105%)' },
          { value: '1.1', label: 'Maior (110%)' },
          { value: '1.15', label: 'Um pouco bem maior (115%)' },
          { value: '1.2', label: 'Bem maior (120%)' },
          { value: '1.25', label: 'Grande (125%)' },          
          { value: '1.3', label: 'Bem grande (130%)' },
          { value: '1.35', label: 'Muito grande (135%)' },
          { value: '1.4', label: 'Extra grande (140%)' },
          { value: '1.45', label: 'Extra grande + (145%)' },
          { value: '1.5', label: 'Máximo (150%)' },          
        ],
        help: 'Diminui ou aumenta o tamanho de quase todo o texto do site de uma vez só (títulos, textos, botões, menu), com bastante graduação pra você achar o tamanho exato que quiser. Útil se algum texto estiver maior ou menor do que você gostaria em geral.',
      })}
      ${field({ label: 'Cor do texto do site', name: 'site_text_color', value: s.site_text_color, type: 'color', placeholder: '#f5f4f0', help: 'Muda a cor principal do texto em todo o site (títulos, parágrafos, menu). Textos secundários (datas, legendas pequenas, categorias) continuam num tom mais discreto de propósito, pra manter a leitura confortável. Como o fundo do site é escuro, escolha uma cor clara/de contraste alto — deixando em branco, volta pro branco levemente creme de sempre.' })}
      ${field({ label: 'Legenda acima do título da Home', name: 'hero_eyebrow', value: s.hero_eyebrow, placeholder: 'Produção Audiovisual · Salvador, BA' })}
      ${field({ label: 'Título de destaque na Home', name: 'hero_headline', value: s.hero_headline, help: 'Quer mais respiro entre duas palavras específicas? É só digitar espaços extras entre elas aqui mesmo (ex: caprichando na barra de espaço) — o site já respeita e mostra o espaço a mais na tela automaticamente, sem precisar mexer em código.' })} ${field({ label: 'Cor da legenda "Produção Audiovisual" e da última palavra do título (ex: "filmes")', name: 'hero_accent_color', value: s.hero_accent_color, type: 'color', placeholder: '#f6c445', help: 'Pedido em 22/09/2026: essas duas partes (a legenda pequena acima do título e a última palavra em destaque, tipo "filmes") agora usam a mesma cor, editável por aqui. Deixando em branco, volta pro dourado de sempre.' })}
      ${field({ label: 'Subtítulo da Home', name: 'hero_subheadline', value: s.hero_subheadline, textarea: true, rows: 2 })}
      ${field({ label: 'URL do vídeo de fundo da Home (opcional, .mp4 ou link do YouTube)', name: 'hero_video_url', value: s.hero_video_url, help: 'Cole aqui um link direto de vídeo (ex: Cloudinary), um link do YouTube (adicionado em 17/09/2026 — antes só um arquivo direto funcionava aqui), OU envie o arquivo direto no campo logo abaixo (o arquivo enviado tem prioridade sobre o link, se os dois estiverem preenchidos). Deixe vazio para usar imagem.' })}
      <div class="form-field" data-single-upload>
        <label>Ou arraste/envie o vídeo direto (sem precisar de link externo)</label>
        <input type="file" accept="video/*">
        <input type="hidden" name="hero_video_data">
        ${(() => {
          // Prévia aqui embaixo: um link do YouTube/Vimeo não dá pra pré-visualizar numa tag
          // <video> normal (não é um arquivo de vídeo) — mostramos o player embutido de verdade
          // nesse caso. Ainda mantemos a tag <video data-preview> escondida por baixo pra o
          // upload de arquivo (ver public/js/admin.js) continuar funcionando normalmente se você
          // decidir enviar um arquivo em vez do link.
          const parsed = parseVideoUrl(s.hero_video_url);
          const isEmbed = parsed && (parsed.provider === 'youtube' || parsed.provider === 'vimeo');
          if (isEmbed) {
            return `<div style="max-width:280px;margin-top:8px;">${videoEmbedHtml(parsed)}</div>
        <video data-preview src="" muted controls playsinline style="display:none;max-width:280px;border-radius:6px;margin-top:8px;"></video>`;
          }
          return `<video data-preview src="${escapeHtml(s.hero_video_url || '')}" muted controls playsinline style="max-width:280px;border-radius:6px;margin-top:8px;${s.hero_video_url ? 'display:block;' : 'display:none;'}"></video>`;
        })()}
        <small>Limite de 25MB — prefira um clipe curto (poucos segundos) e já comprimido, pra carregar rápido. Enviando um vídeo aqui, ele substitui automaticamente o link do campo acima ao salvar.</small>
      </div>
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
      <h2 style="margin-top:32px;">Textos das seções da Home</h2>
      <p class="muted" style="margin-top:-8px;">Títulos que apareciam fixos no código — pedido do usuário em 10/09/2026 (e numa rodada maior em 17/09/2026, cobrindo o resto do site) pra deixar tudo editável por aqui. Deixando em branco, volta pro texto padrão.</p>
      ${field({ label: 'Botão "Ver portfólio" do topo da Home', name: 'hero_cta_primary_text', value: s.hero_cta_primary_text, placeholder: 'Ver portfólio' })}
      ${field({ label: 'Botão "Entrar em contato" do topo da Home', name: 'hero_cta_secondary_text', value: s.hero_cta_secondary_text, placeholder: 'Entrar em contato' })}
      ${field({ label: 'Legenda da seção "Projeto em destaque"', name: 'featured_eyebrow', value: s.featured_eyebrow, placeholder: 'Projeto em destaque' })}
      ${field({ label: 'Botão do projeto em destaque', name: 'featured_cta_text', value: s.featured_cta_text, placeholder: 'Assistir projeto' })}
      ${field({ label: 'Legenda da vitrine de projetos recentes', name: 'recent_eyebrow', value: s.recent_eyebrow, placeholder: 'Trabalhos recentes' })}
      ${field({ label: 'Título da vitrine de projetos recentes', name: 'recent_title', value: s.recent_title, placeholder: 'Portfólio selecionado' })}
      ${field({ label: 'Botão "Ver tudo" da vitrine', name: 'recent_cta_text', value: s.recent_cta_text, placeholder: 'Ver tudo' })}
      ${field({ label: 'Texto quando ainda não há projetos', name: 'recent_empty_text', value: s.recent_empty_text, placeholder: 'Novos projetos em breve.' })}
      ${field({ label: 'Legenda da seção de categorias', name: 'categories_eyebrow', value: s.categories_eyebrow, placeholder: 'Explore' })}
      ${field({ label: 'Título da seção de categorias', name: 'categories_title', value: s.categories_title, placeholder: 'Categorias' })}
      ${field({ label: 'Legenda da seção "sobre" da Home', name: 'intro_eyebrow', value: s.intro_eyebrow, placeholder: 'A NJFILMES' })}
      ${field({ label: 'Título da seção "sobre" da Home', name: 'intro_title', value: s.intro_title, placeholder: 'Cinema, no seu momento mais importante' })}
      ${field({ label: 'Texto da seção "sobre" da Home', name: 'intro_text', value: s.intro_text, textarea: true, rows: 3 })}
      ${field({ label: 'Botão "Conheça a história"', name: 'intro_cta_text', value: s.intro_cta_text, placeholder: 'Conheça a história' })}
      ${field({ label: 'Legenda da seção Serviços', name: 'services_eyebrow', value: s.services_eyebrow, placeholder: 'O que fazemos' })}
      ${field({ label: 'Título da seção Serviços', name: 'services_title', value: s.services_title, placeholder: 'Serviços' })}
      ${field({ label: 'Subtítulo da página Serviços', name: 'services_subtitle', value: s.services_subtitle, textarea: true, rows: 2, help: 'Aparece só no topo da página /servicos, embaixo do título.' })}
      ${field({ label: 'Título da seção de orçamento no fim da página Serviços', name: 'services_cta_title', value: s.services_cta_title, placeholder: 'Pronto para começar seu projeto?' })}
      ${field({ label: 'Legenda da seção Clientes', name: 'clients_eyebrow', value: s.clients_eyebrow, placeholder: 'Conheça alguns' })}
      ${field({ label: 'Título da seção Clientes', name: 'clients_title', value: s.clients_title, placeholder: 'Clientes' })}
      ${field({ label: 'Legenda da seção de depoimentos', name: 'testimonials_eyebrow', value: s.testimonials_eyebrow, placeholder: 'O que dizem' })}
      ${field({ label: 'Título da seção de depoimentos', name: 'testimonials_title', value: s.testimonials_title, placeholder: 'Feedback de clientes' })}
      ${field({ label: 'Legenda da seção de orçamento', name: 'cta_eyebrow', value: s.cta_eyebrow, placeholder: 'Vamos gravar sua história?' })}
      ${field({ label: 'Título da seção de orçamento', name: 'cta_title', value: s.cta_title, placeholder: 'Solicite um orçamento sem compromisso' })}
      ${field({ label: 'Botão "Pedir orçamento" da Home', name: 'cta_button_text', value: s.cta_button_text, placeholder: 'Pedir orçamento' })}
      <h2 style="margin-top:32px;">Portfólio</h2>
      ${field({ label: 'Legenda das páginas de Portfólio', name: 'portfolio_eyebrow', value: s.portfolio_eyebrow, placeholder: 'Portfólio' })}
      ${field({ label: 'Título da página Portfólio', name: 'portfolio_title', value: s.portfolio_title, placeholder: 'Trabalhos NJFILMES' })}
      ${field({ label: 'Subtítulo da página Portfólio', name: 'portfolio_subtitle', value: s.portfolio_subtitle, textarea: true, rows: 2 })}
      <h2 style="margin-top:32px;">Página de cada projeto</h2>
      <p class="muted" style="margin-top:-8px;">Textos que aparecem em toda página de projeto (o mesmo texto, não muda de projeto pra projeto).</p>
      ${field({ label: 'Título "Mais vídeos"', name: 'project_more_videos_title', value: s.project_more_videos_title, placeholder: 'Mais vídeos' })}
      ${field({ label: 'Título "Comentários"', name: 'project_comments_title', value: s.project_comments_title, placeholder: 'Comentários' })}
      ${field({ label: 'Título da seção de orçamento no fim da página do projeto', name: 'project_cta_title', value: s.project_cta_title, placeholder: 'Gostou? Vamos criar o seu projeto' })}
      <h2 style="margin-top:32px;">Contato</h2>
      ${field({ label: 'Legenda da página de Contato', name: 'contact_eyebrow', value: s.contact_eyebrow, placeholder: 'Contato' })}
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
      ${field({ label: 'Link de avaliação do Google (Perfil da Empresa)', name: 'google_review_url', value: s.google_review_url, type: 'url', help: 'No seu Perfil da Empresa no Google, clique em "Solicitar avaliações" pra pegar o link (formato g.page/r/.../review). Preenchendo aqui, aparece um botão "Avalie-nos no Google" no rodapé e na página Contato.' })}
      <h2 style="margin-top:32px;">Página /links (link único para a bio do Instagram)</h2>
      <p class="muted" style="margin-top:-8px;">Essa página (<a href="/links" target="_blank" rel="noopener">njfilmes.com.br/links</a>) é montada automaticamente com as redes sociais e o WhatsApp preenchidos acima — não precisa editar em outro lugar. Os botões extras que aparecem nela vêm da lista em <a href="/admin/links">Links</a>, no menu. Aqui você só ajusta o texto que fica embaixo do nome.</p>
      ${field({ label: 'Frase abaixo do nome na página /links', name: 'links_tagline', value: s.links_tagline })}
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
  // Vídeo de fundo da Home: pode vir por link colado (hero_video_url) OU por arquivo enviado
  // direto (hero_video_data) — pedido do usuário em 10/09/2026. O arquivo enviado tem prioridade
  // sobre o link (se os dois vierem preenchidos); se o upload falhar, mantém o que já estava
  // configurado em vez de apagar o vídeo do ar.
  let hero_video_url = body.hero_video_url || '';
  let videoUploadFailed = false;
  if (body.hero_video_data) {
    try {
      hero_video_url = await saveVideoFile(body.hero_video_data);
    } catch (e) {
      videoUploadFailed = true;
      console.error('Erro ao salvar vídeo de fundo da Home:', e.message);
      const current = await Q.getSettings();
      hero_video_url = body.hero_video_url || current.hero_video_url || '';
    }
  }
  await Q.updateSettings({
    site_name: body.site_name || 'NJFILMES',
    tagline: body.tagline || '',
    hero_eyebrow: body.hero_eyebrow || '', hero_accent_color: body.hero_accent_color || '',
    hero_headline: body.hero_headline || '',
    hero_subheadline: body.hero_subheadline || '',
    hero_video_url,
    hero_photo,
    meta_title: body.meta_title || '',
    meta_description: body.meta_description || '',
    og_image,
    footer_text: body.footer_text || '',
    services_eyebrow: body.services_eyebrow || '',
    services_title: body.services_title || '',
    services_subtitle: body.services_subtitle || '',
    clients_eyebrow: body.clients_eyebrow || '',
    clients_title: body.clients_title || '',
    cta_eyebrow: body.cta_eyebrow || '',
    cta_title: body.cta_title || '',
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
    google_review_url: body.google_review_url || '',
    links_tagline: body.links_tagline || '',
    site_font_preset: body.site_font_preset || '',
    site_font_weight: body.site_font_weight || '',
    site_font_scale: body.site_font_scale || '',
    site_text_color: body.site_text_color || '',
    // 17/09/2026: rodada de "quero todo o site com textos editáveis" (ver server/db.js).
    featured_eyebrow: body.featured_eyebrow || '',
    featured_cta_text: body.featured_cta_text || '',
    recent_eyebrow: body.recent_eyebrow || '',
    recent_title: body.recent_title || '',
    recent_cta_text: body.recent_cta_text || '',
    recent_empty_text: body.recent_empty_text || '',
    categories_eyebrow: body.categories_eyebrow || '',
    categories_title: body.categories_title || '',
    intro_eyebrow: body.intro_eyebrow || '',
    intro_title: body.intro_title || '',
    intro_text: body.intro_text || '',
    intro_cta_text: body.intro_cta_text || '',
    testimonials_eyebrow: body.testimonials_eyebrow || '',
    testimonials_title: body.testimonials_title || '',
    hero_cta_primary_text: body.hero_cta_primary_text || '',
    hero_cta_secondary_text: body.hero_cta_secondary_text || '',
    cta_button_text: body.cta_button_text || '',
    portfolio_eyebrow: body.portfolio_eyebrow || '',
    portfolio_title: body.portfolio_title || '',
    portfolio_subtitle: body.portfolio_subtitle || '',
    project_more_videos_title: body.project_more_videos_title || '',
    project_comments_title: body.project_comments_title || '',
    project_cta_title: body.project_cta_title || '',
    services_cta_title: body.services_cta_title || '',
    contact_eyebrow: body.contact_eyebrow || '',
  });
  redirect(res, '/admin/configuracoes' + withFlash(
    res,
    videoUploadFailed ? 'error' : 'success',
    videoUploadFailed ? 'Configurações salvas, mas o vídeo enviado não pôde ser salvo (arquivo inválido ou maior que 25MB) — o vídeo/link anterior foi mantido.' : 'Configurações salvas.'
  ));
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
      const { filename, thumbFilename, width, height } = await saveProjectPhoto(dataUrl);
      order += 1;
      await Q.addPhoto(id, { filename, thumbFilename, sort_order: order, is_cover: isFirstBatch && saved === 0 ? 1 : 0, width, height });
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

// ---------------- Entregas (página individual pra cada cliente) ----------------
// Mesmo padrão de Projetos acima (abas Informações/Vídeos/Fotos), com uma aba a mais
// (Comentários) e sem categoria — pedido do usuário em 12/09/2026 pra parar de depender da
// ferramenta separada (Claude) pra montar a entrega de cada cliente. A página pública fica em
// /entregas/:slug (ver server/routes/public.js e server/deliveryPage.js) e só existe de verdade
// (no site publicado) quando "published" está marcado E o site estático for republicado — a
// mesma regra de "published" que os projetos já seguem.
const SITE_URL = process.env.SITE_URL || 'https://njfilmes.com.br';

function renderDeliveryCasesTable(cases) {
  if (!cases.length) return '<p class="empty-hint">Nenhuma entrega ainda. Clique em "Nova entrega" para criar a primeira.</p>';
  // Pedido do usuario (17/09/2026): mostrar a data (dia/mes/ano) em que cada cliente foi
  // adicionado - usa a mesma coluna "created_at" que a tabela ja tinha, so faltava exibir.
  const rows = cases
    .map(
      (c) => `<tr>
      <td><img class="thumb-sm" src="${escapeHtml(c.cover_photo || '/img/project-placeholder.jpg')}" alt=""></td>
      <td><a href="/admin/entregas/${c.id}">${escapeHtml(c.client_name)}</a></td>
      <td>${c.published ? `<span class="tag tag-published">Publicada</span> <a href="${SITE_URL}/entregas/${escapeHtml(c.slug)}" target="_blank" style="font-size:.8rem;">Ver link ↗</a>` : '<span class="tag tag-draft">Rascunho</span>'}</td>
      <td class="muted" style="font-size:.85rem;white-space:nowrap;">${escapeHtml(formatDatePtBr(c.created_at))}</td>
      <td class="row-actions">
        <a class="btn-a btn-a-sm" href="/admin/entregas/${c.id}">Editar</a>
        <form method="post" action="/admin/entregas/${c.id}/excluir" data-confirm="Excluir a entrega de &quot;${escapeHtml(c.client_name)}&quot;? Isso remove também as fotos e vídeos dela."><button class="btn-a btn-a-sm btn-a-danger" type="submit">Excluir</button></form>
      </td>
    </tr>`
    )
    .join('');
  return `<table class="admin-table"><thead><tr><th>Capa</th><th>Cliente</th><th>Status</th><th>Data</th><th>Ações</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export async function deliveryCasesListPage(req, res, admin) {
  const flash = readFlash(req);
  const cases = await Q.listDeliveryCases();
  const content = `
  <div class="panel-head" style="margin-bottom:18px;">
    <h2 style="margin:0;">Entregas (${cases.length})</h2>
    <a class="btn-a btn-a-primary" href="/admin/entregas/novo">+ Nova entrega</a>
  </div>
  <div class="panel"><p class="muted" style="margin-top:0;">Monte a página de entrega de cada cliente (fotos, vídeos e link de download) e mande o link direto no WhatsApp. Enquanto estiver "Rascunho", a página não aparece pra ninguém.</p></div>
  <div class="panel">${renderDeliveryCasesTable(cases)}</div>`;
  res.end(adminLayout({ title: 'Entregas', activePath: '/admin/entregas', admin, content, flash }));
}

function deliveryInfoForm({ action, deliveryCase = {} }) {
  return `<form method="post" action="${action}">
    <div class="form-row">
      ${field({ label: 'Nome do cliente', name: 'client_name', value: deliveryCase.client_name, required: true, placeholder: 'Ex: João & Maria' }).replace('<input', '<input data-slug-source')}
      ${field({ label: 'URL (slug)', name: 'slug', value: deliveryCase.slug, help: 'Endereço final: /entregas/seu-texto-aqui' }).replace('<input', '<input data-slug-target')}
    </div>
    ${field({ label: 'Etiqueta acima do nome na capa (opcional)', name: 'cover_label', value: deliveryCase.cover_label, placeholder: 'Ex: Ensaio, Casamento, Aftermovie...', help: 'Se deixar em branco, aparece o padrão "NJFILMES · Entrega".' })}
    ${field({ label: 'Mensagem de boas-vindas (opcional)', name: 'welcome_message', value: deliveryCase.welcome_message, textarea: true, rows: 4, placeholder: 'Ex: Ficou pronto o seu ensaio! Deu uma olhadinha, saiu lindo...' })}
    <div class="form-row">
      ${field({ label: 'Link pra baixar as fotos em alta (Mega, Drive, WeTransfer...)', name: 'photos_download_url', value: deliveryCase.photos_download_url, placeholder: 'https://...' })}
      ${field({ label: 'Texto do botão de download das fotos', name: 'photos_download_label', value: deliveryCase.photos_download_label || 'Baixar fotos em alta' })}
    </div>
    ${field({ label: 'WhatsApp do cliente (opcional, só de referência sua)', name: 'whatsapp_number', value: deliveryCase.whatsapp_number, placeholder: 'Ex: 5511999999999' })}
    ${checkboxField({ label: 'Publicada (a página fica acessível pelo link assim que o site republicar)', name: 'published', checked: !!deliveryCase.published })}
    <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Salvar</button></div>
  </form>`;
}

export async function deliveryCaseNewPage(req, res, admin) {
  const content = `<div class="panel"><h2>Nova entrega</h2>${deliveryInfoForm({ action: '/admin/entregas/criar' })}</div>`;
  res.end(adminLayout({ title: 'Nova entrega', activePath: '/admin/entregas', admin, content }));
}

export async function deliveryCaseCreate(req, res, body) {
  const clientName = (body.client_name || '').trim();
  if (!clientName) return redirect(res, '/admin/entregas/novo');
  const slug = await uniqueSlug(['delivery_cases'], (body.slug || '').trim() || clientName);
  const id = await Q.createDeliveryCase({ client_name: clientName, slug, welcome_message: body.welcome_message });
  redirect(res, `/admin/entregas/${id}` + withFlash(res, 'success', 'Entrega criada! Agora adicione fotos e vídeos.'));
}

function deliveryTabs(id, active) {
  const tabs = [
    ['info', 'Informações'],
    ['videos', 'Vídeos'],
    ['fotos', 'Fotos'],
    ['comentarios', 'Comentários'],
  ];
  return `<div class="tabs">${tabs
    .map(([key, label]) => `<a class="tab-link ${active === key ? 'active' : ''}" href="/admin/entregas/${id}${key === 'info' ? '' : '/' + key}">${label}</a>`)
    .join('')}</div>`;
}

export async function deliveryCaseEditPage(req, res, admin, id, tab = 'info') {
  const deliveryCase = await Q.getDeliveryCase(id);
  if (!deliveryCase) return redirect(res, '/admin/entregas');
  const flash = readFlash(req);

  // Posição de cada foto/vídeo na ordem combinada que aparece pro cliente na entrega (mistura
  // foto e vídeo) — mostrado nas duas abas pra tirar a dúvida "como eu sei a ordem" (17/09/2026).
  const combinedMedia = combinedDeliveryMedia(deliveryCase);
  const combinedTotal = combinedMedia.length;
  const combinedPosition = (kind, mediaId) => combinedMedia.findIndex((it) => it.kind === kind && it.id === mediaId) + 1;

  let body;
  if (tab === 'videos') {
    body = `
    ${deliveryTabs(id, 'videos')}
    <div class="panel">
      <h2>Adicionar vídeo (prévia)</h2>
      <p class="muted" style="margin-top:-8px;">Cole o link do YouTube, Vimeo, Mega ou Google Drive — toca direto na página (Mega e Drive precisam estar compartilhados como "qualquer pessoa com o link"). O campo "link pra baixar o arquivo completo" é opcional e separado — use quando a prévia mostra só um trecho e o arquivo de verdade é maior.</p>
      <form method="post" action="/admin/entregas/${id}/videos/criar">
        <div class="form-row">
          ${field({ label: 'URL do vídeo (prévia)', name: 'url', required: true, placeholder: 'https://www.youtube.com/watch?v=...' })}
          ${field({ label: 'Título (opcional)', name: 'title', placeholder: 'Ex: Making of' })}
        </div>
        ${field({ label: 'Texto que aparece ACIMA do vídeo na entrega (opcional)', name: 'top_text', placeholder: 'Ex: O grande dia' })}
        ${field({ label: 'Link pra baixar o vídeo completo (opcional)', name: 'download_url', placeholder: 'https://...' })}
        <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Adicionar vídeo</button></div>
      </form>
      <p class="muted" style="margin-top:14px;">Prefere não usar link? Também dá pra arrastar o arquivo de vídeo direto:</p>
      <div class="upload-drop" data-video-upload-drop data-upload-url="/admin/entregas/${id}/videos/upload">
        <input type="file" accept="video/*">
        <p>Clique aqui ou arraste um vídeo (.mp4, .webm, .mov) para enviar</p>
        <p data-video-upload-status style="margin-top:10px;font-size:0.82rem;"></p>
        <small>Limite de 25MB — prefira um clipe curto e já comprimido. Depois de enviado, preencha título/texto/link de download na lista abaixo.</small>
      </div>
    </div>
    <div class="panel">
      <h2>Vídeos (${deliveryCase.videos.length})</h2>
      <p class="muted" style="margin-top:-8px;">A numeração abaixo é a posição real na entrega — foto e vídeo aparecem intercalados na ordem que você montar aqui, não "vídeos primeiro".</p>
      ${deliveryCase.videos.length ? deliveryCase.videos.map((v) => {
        const pos = combinedPosition('video', v.id);
        return `
        <div class="video-item video-item-edit">
          <div class="vi-info"><span class="vi-pos">Posição ${pos} de ${combinedTotal}</span><span>${v.provider === 'file' ? 'Arquivo enviado direto' : escapeHtml(v.url)}</span></div>
          <form method="post" action="/admin/entregas/${id}/videos/${v.id}/editar">
            <div class="form-row">
              <input type="text" name="title" value="${escapeHtml(v.title || '')}" placeholder="Título (opcional)">
              <input type="text" name="top_text" value="${escapeHtml(v.top_text || '')}" placeholder="Texto de cima (opcional)">
            </div>
            <input type="text" name="download_url" value="${escapeHtml(v.download_url || '')}" placeholder="Link pra baixar o vídeo completo (opcional)">
            <div class="form-actions"><button class="btn-a btn-a-sm" type="submit">Salvar</button></div>
          </form>
          <div class="pc-actions">
            <form method="post" action="/admin/entregas/${id}/videos/${v.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="up"><button class="btn-a btn-a-sm" ${pos <= 1 ? 'disabled' : ''}>↑</button></form>
            <form method="post" action="/admin/entregas/${id}/videos/${v.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="down"><button class="btn-a btn-a-sm" ${pos >= combinedTotal ? 'disabled' : ''}>↓</button></form>
            <form method="post" action="/admin/entregas/${id}/videos/${v.id}/excluir" data-confirm="Remover este vídeo?"><button class="btn-a btn-a-sm btn-a-danger" type="submit">Remover</button></form>
          </div>
        </div>`;
      }).join('') : '<p class="empty-hint">Nenhum vídeo adicionado ainda.</p>'}
    </div>`;
  } else if (tab === 'fotos') {
    body = `
    ${deliveryTabs(id, 'fotos')}
    <div class="panel">
      <h2>Enviar fotos</h2>
      <p class="muted" style="margin-top:-8px;">Selecione várias fotos de uma vez. Elas são otimizadas e uma miniatura é gerada automaticamente — a primeira foto enviada vira a capa da página.</p>
      <div class="upload-drop" data-upload-drop data-upload-url="/admin/entregas/${id}/fotos/upload">
        <input type="file" accept="image/*" multiple>
        <p>Clique aqui ou arraste as fotos para enviar</p>
        <div id="upload-preview"></div>
        <p data-upload-status style="margin-top:10px;font-size:0.82rem;"></p>
      </div>
    </div>
    <div class="panel">
      <h2>Fotos da entrega (${deliveryCase.photos.length})</h2>
      <p class="muted" style="margin-top:-8px;">A numeração abaixo é a posição real na entrega — foto e vídeo aparecem intercalados na ordem que você montar aqui, não "fotos primeiro".</p>
      ${deliveryCase.photos.length ? `<div class="photo-grid">${deliveryCase.photos
        .map(
          (p) => {
            const pos = combinedPosition('foto', p.id);
            return `<div class="photo-card">
          <img src="${escapeHtml(p.thumb_filename)}" alt="">
          <div class="pc-body">
            <span class="vi-pos">Posição ${pos} de ${combinedTotal}</span>
            ${p.is_cover ? '<span class="is-cover-badge">Capa</span>' : ''}
            <form method="post" action="/admin/entregas/${id}/fotos/${p.id}/legenda">
              <input type="text" name="top_text" value="${escapeHtml(p.top_text || '')}" placeholder="Texto de cima (opcional)">
              <input type="text" name="caption" value="${escapeHtml(p.caption || '')}" placeholder="Legenda de baixo (opcional)">
              <button class="btn-a btn-a-sm" type="submit">Salvar textos</button>
            </form>
            <div class="pc-actions">
              ${!p.is_cover ? `<form method="post" action="/admin/entregas/${id}/fotos/${p.id}/capa"><button class="btn-a btn-a-sm">Definir capa</button></form>` : ''}
              <form method="post" action="/admin/entregas/${id}/fotos/${p.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="up"><button class="btn-a btn-a-sm" ${pos <= 1 ? 'disabled' : ''}>↑</button></form>
              <form method="post" action="/admin/entregas/${id}/fotos/${p.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="down"><button class="btn-a btn-a-sm" ${pos >= combinedTotal ? 'disabled' : ''}>↓</button></form>
              <form method="post" action="/admin/entregas/${id}/fotos/${p.id}/excluir" data-confirm="Excluir esta foto?"><button class="btn-a btn-a-sm btn-a-danger">Excluir</button></form>
            </div>
          </div>
        </div>`;
          }
        )
        .join('')}</div>` : '<p class="empty-hint">Nenhuma foto enviada ainda.</p>'}
    </div>`;
  } else if (tab === 'comentarios') {
    const comments = deliveryCase.comments || [];
    body = `
    ${deliveryTabs(id, 'comentarios')}
    <div class="panel">
      <h2>Comentários (${comments.length})</h2>
      <p class="muted" style="margin-top:-8px;">O que o cliente escreveu na página dele. Você pode responder publicamente (aparece logo abaixo do comentário) ou excluir.</p>
    </div>
    ${comments.length ? comments.map((c) => `
      <div class="panel comment-admin-item">
        <div class="comment-admin-head">
          <div><b>${escapeHtml(c.author_name)}</b><span class="muted"> · ${escapeHtml(formatDateTimePtBr(c.created_at))}</span></div>
          <form method="post" action="/admin/entregas/${id}/comentarios/${c.id}/remover" data-confirm="Excluir este comentário?"><button class="btn-a btn-a-sm btn-a-danger" type="submit">Excluir</button></form>
        </div>
        <p class="comment-admin-content">${escapeHtml(c.content)}</p>
        <form method="post" action="/admin/entregas/${id}/comentarios/${c.id}/responder" class="comment-admin-reply-form">
          ${field({ label: 'Sua resposta (aparece publicamente)', name: 'admin_reply', value: c.admin_reply || '', textarea: true, rows: 2 })}
          <div class="form-actions"><button class="btn-a btn-a-primary btn-a-sm" type="submit">Salvar resposta</button></div>
        </form>
      </div>`).join('') : '<div class="panel"><p class="empty-hint">Nenhum comentário ainda.</p></div>'}`;
  } else {
    body = `${deliveryTabs(id, 'info')}<div class="panel"><h2>Informações</h2>${deliveryInfoForm({ action: `/admin/entregas/${id}/atualizar`, deliveryCase })}</div>
    ${deliveryCase.published ? `<div class="panel"><h3>Link da entrega</h3><p><a href="${SITE_URL}/entregas/${escapeHtml(deliveryCase.slug)}" target="_blank">${SITE_URL}/entregas/${escapeHtml(deliveryCase.slug)}</a></p><p class="muted">Depois de publicar/atualizar aqui, o site leva alguns instantes pra republicar antes do link refletir a mudança.</p></div>` : ''}
    <div class="panel">
      <h3>Excluir entrega</h3>
      <p class="muted">Essa ação remove a entrega, suas fotos, vídeos e comentários permanentemente.</p>
      <form method="post" action="/admin/entregas/${id}/excluir" data-confirm="Excluir a entrega de &quot;${escapeHtml(deliveryCase.client_name)}&quot; e todo o seu conteúdo?"><button class="btn-a btn-a-danger" type="submit">Excluir entrega</button></form>
    </div>`;
  }

  res.end(adminLayout({ title: deliveryCase.client_name, activePath: '/admin/entregas', admin, content: body, flash }));
}

export async function deliveryCaseUpdate(req, res, body, id) {
  const deliveryCase = await Q.getDeliveryCase(id);
  if (!deliveryCase) return redirect(res, '/admin/entregas');
  const clientName = (body.client_name || deliveryCase.client_name).trim();
  const slug = (body.slug || '').trim() ? await uniqueSlug(['delivery_cases'], body.slug, id) : deliveryCase.slug;
  await Q.updateDeliveryCase(id, {
    client_name: clientName,
    slug,
    welcome_message: body.welcome_message,
    cover_photo: deliveryCase.cover_photo,
    cover_label: body.cover_label,
    photos_download_url: body.photos_download_url,
    photos_download_label: body.photos_download_label,
    whatsapp_number: body.whatsapp_number,
    published: !!body.published,
  });
  redirect(res, `/admin/entregas/${id}` + withFlash(res, 'success', 'Entrega atualizada.'));
}

export async function deliveryCaseDelete(req, res, id) {
  // Antes de excluir a entrega, apaga os arquivos de cada foto (R2/Vercel Blob/disco) — sem isso,
  // excluir a entrega no painel apagava só as linhas do banco, e as imagens em si ficavam
  // esquecidas ocupando espaço de armazenamento pra sempre. Pedido do usuário em 17/09/2026: se o
  // R2 encher, excluir entregas antigas precisa de fato liberar espaço.
  const photos = await Q.listDeliveryPhotosForCase(id);
  for (const photo of photos) {
    try {
      await deleteDeliveryPhotoFiles(photo.filename, photo.thumb_filename);
    } catch (err) {
      console.error('Erro ao apagar arquivo de foto da entrega:', err.message);
    }
  }
  // Mesma limpeza pros vídeos enviados direto (provider "file", ver aba de vídeos) — um vídeo que
  // seja só um link (YouTube/Mega/Drive) não tem arquivo pra apagar aqui, só a linha do banco.
  const videos = await Q.listDeliveryVideosForCase(id);
  for (const video of videos) {
    if (video.provider !== 'file') continue;
    try {
      await deleteDeliveryVideoFile(video.url);
    } catch (err) {
      console.error('Erro ao apagar arquivo de vídeo da entrega:', err.message);
    }
  }
  await Q.deleteDeliveryCase(id);
  redirect(res, '/admin/entregas' + withFlash(res, 'success', 'Entrega excluída.'));
}

export async function deliveryVideoCreate(req, res, body, id) {
  const parsed = parseVideoUrl(body.url);
  if (!parsed) return redirect(res, `/admin/entregas/${id}/videos` + withFlash(res, 'error', 'Link de vídeo inválido.'));
  const maxOrder = await maxCombinedDeliverySortOrder(id);
  await Q.addDeliveryVideo(id, {
    provider: parsed.provider,
    video_id: parsed.videoId,
    url: parsed.url,
    title: body.title,
    top_text: (body.top_text || '').trim(),
    download_url: (body.download_url || '').trim(),
    sort_order: maxOrder + 1,
  });
  redirect(res, `/admin/entregas/${id}/videos` + withFlash(res, 'success', 'Vídeo adicionado.'));
}

// Pedido do usuário em 17/09/2026: além de colar o link, poder arrastar o ARQUIVO de vídeo direto
// pra aba (mesma ideia do "arraste as fotos" que já existe na aba de Fotos). O vídeo entra sem
// título/texto/link de download — a pessoa preenche isso depois pelo formulário de editar de cada
// vídeo (ver deliveryVideoUpdate abaixo), igual já funciona com a legenda das fotos.
export async function deliveryVideoUploadFile(req, res, body, id) {
  const deliveryCase = await Q.getDeliveryCase(id);
  if (!deliveryCase) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'Entrega não encontrada.' }));
  }
  if (!body.video) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'Nenhum vídeo recebido.' }));
  }
  try {
    const url = await saveDeliveryVideoFile(body.video);
    const maxOrder = await maxCombinedDeliverySortOrder(id);
    await Q.addDeliveryVideo(id, { provider: 'file', video_id: '', url, title: '', top_text: '', download_url: '', sort_order: maxOrder + 1 });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

// Pedido do usuário em 17/09/2026: poder editar título/texto de cima/link de download de um
// vídeo já adicionado, sem precisar excluir e recriar — igual já era possível com a legenda das
// fotos.
export async function deliveryVideoUpdate(req, res, body, id, videoId) {
  await Q.updateDeliveryVideo(videoId, {
    title: body.title,
    top_text: body.top_text,
    download_url: body.download_url,
  });
  redirect(res, `/admin/entregas/${id}/videos` + withFlash(res, 'success', 'Vídeo atualizado.'));
}

export async function deliveryVideoDelete(req, res, id, videoId) {
  // Se o vídeo foi enviado direto (provider "file"), apaga o arquivo também — senão fica
  // esquecido ocupando espaço, igual já foi corrigido pra foto (ver deliveryCaseDelete acima).
  const video = await Q.getDeliveryVideo(videoId);
  if (video && video.provider === 'file') {
    try {
      await deleteDeliveryVideoFile(video.url);
    } catch (err) {
      console.error('Erro ao apagar arquivo de vídeo da entrega:', err.message);
    }
  }
  await Q.deleteDeliveryVideo(videoId);
  redirect(res, `/admin/entregas/${id}/videos`);
}

export async function deliveryPhotosUpload(req, res, body, id) {
  const deliveryCase = await Q.getDeliveryCase(id);
  if (!deliveryCase) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'Entrega não encontrada.' }));
  }
  const photos = Array.isArray(body.photos) ? body.photos : [];
  if (!photos.length) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'Nenhuma foto recebida.' }));
  }
  let order = await maxCombinedDeliverySortOrder(id);
  let saved = 0;
  const isFirstBatch = deliveryCase.photos.length === 0;
  for (const dataUrl of photos) {
    try {
      const { filename, thumbFilename, width, height } = await saveDeliveryPhoto(dataUrl);
      order += 1;
      await Q.addDeliveryPhoto(id, { filename, thumbFilename, sort_order: order, is_cover: isFirstBatch && saved === 0 ? 1 : 0, width, height });
      if (isFirstBatch && saved === 0) {
        await query('UPDATE delivery_cases SET cover_photo = $1 WHERE id = $2', [filename, id]);
      }
      saved += 1;
    } catch (err) {
      console.error('Erro ao salvar foto de entrega:', err.message);
    }
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, saved }));
}

export async function deliveryPhotoDelete(req, res, id, photoId) {
  const photo = await Q.getDeliveryPhoto(photoId);
  if (photo) {
    await deleteDeliveryPhotoFiles(photo.filename, photo.thumb_filename);
    await Q.deleteDeliveryPhoto(photoId);
    if (photo.is_cover) {
      const next = await queryOne('SELECT * FROM delivery_photos WHERE case_id = $1 ORDER BY sort_order ASC LIMIT 1', [id]);
      if (next) {
        await query('UPDATE delivery_photos SET is_cover = 1 WHERE id = $1', [next.id]);
        await query('UPDATE delivery_cases SET cover_photo = $1 WHERE id = $2', [next.filename, id]);
      } else {
        await query('UPDATE delivery_cases SET cover_photo = $1 WHERE id = $2', ['', id]);
      }
    }
  }
  redirect(res, `/admin/entregas/${id}/fotos`);
}

export async function deliveryPhotoSetCover(req, res, id, photoId) {
  await Q.setDeliveryPhotoAsCover(id, photoId);
  redirect(res, `/admin/entregas/${id}/fotos`);
}

export async function deliveryPhotoCaption(req, res, body, id, photoId) {
  await Q.setDeliveryPhotoTexts(photoId, { caption: body.caption || '', top_text: body.top_text || '' });
  redirect(res, `/admin/entregas/${id}/fotos`);
}

export async function deliveryCommentReply(req, res, body, id, commentId) {
  await Q.updateDeliveryCommentReply(commentId, (body.admin_reply || '').trim());
  redirect(res, `/admin/entregas/${id}/comentarios` + withFlash(res, 'success', 'Resposta salva.'));
}

export async function deliveryCommentDelete(req, res, id, commentId) {
  await Q.deleteDeliveryComment(commentId);
  redirect(res, `/admin/entregas/${id}/comentarios` + withFlash(res, 'success', 'Comentário excluído.'));
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
  const ip = getClientIp(req);
  // Mesma proteção de bloqueio por IP do login (ver server/auth.js) — a recuperação de acesso é
  // uma rota pública que basicamente aceita uma "segunda senha" (a chave de recuperação), então
  // precisa do mesmo limite de tentativas, senão alguém poderia tentar adivinhar a chave sem
  // parar. Guarda separado do login (recoveryGuard), então um não bloqueia o outro.
  if (recoveryGuard.isBlocked(ip)) {
    return redirect(res, '/admin/recuperar-senha' + withFlash(res, 'error', 'Muitas tentativas. Tente novamente em alguns minutos.'));
  }
  const key = process.env.ADMIN_RECOVERY_KEY;
  if (!key) return redirect(res, '/admin/recuperar-senha' + withFlash(res, 'error', 'Recuperação não configurada neste site.'));
  if (!body.recovery_key || !timingSafeStringEqual(body.recovery_key, key)) {
    recoveryGuard.registerFailure(ip);
    return redirect(res, '/admin/recuperar-senha' + withFlash(res, 'error', 'Chave de recuperação incorreta.'));
  }
  recoveryGuard.registerSuccess(ip);
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

// ---------------- Recuperação de senha por e-mail ----------------
// Pedido do usuário em 18/09/2026, no lugar de depender só da chave de recuperação fixa (que
// continua funcionando em /admin/recuperar-senha, só sem link visível - ver comentário na tela
// de login). Fluxo padrão de "esqueci minha senha": pede o e-mail, manda um link com um token que
// expira em 30 minutos (ver createPasswordResetToken em server/auth.js), a pessoa clica e define
// uma senha nova. Precisa de RESEND_API_KEY e RESEND_FROM_EMAIL configurados no Render - ver
// server/mailer.js.

export async function forgotPasswordPage(req, res) {
  const flash = readFlash(req);
  res.end(
    loginLayout({
      title: 'Esqueci minha senha',
      content: `<h1>Esqueci minha senha</h1><p class="sub">Digite o e-mail do seu acesso administrativo. Se ele existir, mandamos um link pra você redefinir a senha.</p>${flash ? `<div class="admin-flash admin-flash-${escapeHtml(flash.type)}" style="margin:0 0 18px;">${escapeHtml(flash.message)}</div>` : ''}<form method="post" action="/admin/esqueci-senha">${field({ label: 'E-mail', name: 'email', type: 'email', required: true })}<div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Enviar link de redefinição</button></div></form><p class="sub" style="margin-top:18px;"><a href="/admin/login">Voltar para o login</a></p>`,
    })
  );
}

export async function forgotPasswordSubmit(req, res, body) {
  const ip = getClientIp(req);
  // Mesma proteção de bloqueio por IP do login/recuperação por chave (ver server/auth.js) - sem
  // isso, alguém poderia ficar pedindo e-mail de redefinição sem parar.
  if (resetRequestGuard.isBlocked(ip)) {
    return redirect(res, '/admin/esqueci-senha' + withFlash(res, 'error', 'Muitas tentativas. Tente novamente em alguns minutos.'));
  }
  resetRequestGuard.registerFailure(ip); // conta toda tentativa (mesmo com sucesso) - ver nota abaixo
  const email = String(body.email || '').toLowerCase().trim();
  const admin = email ? await findAdminByEmail(email) : null;
  // Sempre mostra a mesma mensagem, exista o e-mail ou não - se a mensagem fosse diferente pra
  // "e-mail não encontrado", qualquer pessoa poderia usar essa tela pra descobrir se um e-mail é
  // o do administrador do site. O e-mail só é enviado de verdade quando o admin existe.
  const genericMessage = 'Se esse e-mail estiver cadastrado, você vai receber um link de redefinição em instantes.';
  if (admin) {
    const token = await createPasswordResetToken(admin.id);
    const resetUrl = absoluteUrl(`/admin/redefinir-senha?token=${token}`);
    const result = await sendEmail({
      to: admin.email,
      subject: 'Redefinir senha do painel NJFILMES',
      html: `<p>Recebemos um pedido pra redefinir a senha do painel administrativo da NJFILMES.</p><p><a href="${resetUrl}">Clique aqui pra definir uma nova senha</a> (o link expira em 30 minutos).</p><p>Se você não pediu isso, pode ignorar este e-mail - sua senha continua a mesma.</p>`,
    });
    if (!result.ok) {
      // O envio falhou (ex.: RESEND_API_KEY não configurada) - avisa com uma mensagem honesta em
      // vez de fingir sucesso, senão a pessoa fica esperando um e-mail que nunca chega.
      return redirect(
        res,
        '/admin/esqueci-senha' +
          withFlash(res, 'error', 'Não deu pra enviar o e-mail agora (envio de e-mail não está configurado neste site). Use a chave de recuperação em /admin/recuperar-senha ou tente de novo mais tarde.')
      );
    }
  }
  return redirect(res, '/admin/esqueci-senha' + withFlash(res, 'success', genericMessage));
}

export async function resetPasswordPage(req, res) {
  const flash = readFlash(req);
  const token = new URL(req.url, 'http://x').searchParams.get('token') || '';
  const adminId = await checkPasswordResetToken(token);
  if (!adminId) {
    return res.end(
      loginLayout({
        title: 'Link inválido',
        content: `<h1>Link inválido ou expirado</h1><p class="sub">Esse link de redefinição de senha não existe mais, já foi usado ou expirou (os links duram 30 minutos). Peça um novo.</p><p class="sub" style="margin-top:18px;"><a href="/admin/esqueci-senha">Pedir novo link</a></p>`,
      })
    );
  }
  res.end(
    loginLayout({
      title: 'Definir nova senha',
      content: `<h1>Definir nova senha</h1><p class="sub">Escolha a nova senha do seu acesso administrativo.</p>${flash ? `<div class="admin-flash admin-flash-${escapeHtml(flash.type)}" style="margin:0 0 18px;">${escapeHtml(flash.message)}</div>` : ''}<form method="post" action="/admin/redefinir-senha"><input type="hidden" name="token" value="${escapeHtml(token)}">${field({ label: 'Nova senha', name: 'password', type: 'password', required: true, help: 'Use pelo menos 8 caracteres.' })}${field({ label: 'Confirmar nova senha', name: 'confirm_password', type: 'password', required: true })}<div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Salvar nova senha</button></div></form>`,
    })
  );
}

export async function resetPasswordSubmit(req, res, body) {
  const ip = getClientIp(req);
  if (resetTokenGuard.isBlocked(ip)) {
    return redirect(res, '/admin/esqueci-senha' + withFlash(res, 'error', 'Muitas tentativas. Tente novamente em alguns minutos.'));
  }
  const token = String(body.token || '');
  const { password, confirm_password } = body;
  if (!password || password.length < 8) {
    return redirect(res, `/admin/redefinir-senha?token=${encodeURIComponent(token)}` + withFlash(res, 'error', 'Use uma senha com pelo menos 8 caracteres.'));
  }
  if (password !== confirm_password) {
    return redirect(res, `/admin/redefinir-senha?token=${encodeURIComponent(token)}` + withFlash(res, 'error', 'As senhas não são iguais.'));
  }
  const adminId = await consumePasswordResetToken(token);
  if (!adminId) {
    resetTokenGuard.registerFailure(ip);
    return redirect(res, '/admin/esqueci-senha' + withFlash(res, 'error', 'Esse link não existe mais, já foi usado ou expirou. Peça um novo.'));
  }
  resetTokenGuard.registerSuccess(ip);
  const { hash, salt } = hashPassword(password);
  await query('UPDATE admin_users SET password_hash = $1, salt = $2 WHERE id = $3', [hash, salt, adminId]);
  // Derruba todas as sessões abertas desse admin depois de trocar a senha - se alguém tinha
  // acesso de alguma sessão antiga (ex.: um computador compartilhado), essa troca de senha já
  // tira o acesso dela também, e não só bloqueia login novo.
  await query('DELETE FROM sessions WHERE admin_id = $1', [adminId]);
  return redirect(res, '/admin/login' + withFlash(res, 'success', 'Senha redefinida! Entre com a nova senha.'));
}

// ==================== Seleção de fotos ====================
// Aba separada de "Entregas", pedido do usuário em 17/09/2026 inspirado no site Alboom: antes de
// editar de verdade, o cliente vê as fotos em baixa resolução + marca d'água, marca as favoritas
// e envia — o fotógrafo edita só as escolhidas depois. status percorre: preparo (só o fotógrafo
// vê) -> andamento (link liberado, cliente marca/envia) -> revisao (cliente enviou, fotógrafo
// confere) -> finalizado. "Reativar" volta pra andamento se o cliente precisar mudar algo.
const SELECTION_STATUSES = [
  ['preparo', 'Em preparação'],
  ['andamento', 'Em andamento'],
  ['revisao', 'Em revisão'],
  ['finalizado', 'Finalizado'],
];

function selectionStatusLabel(status) {
  const found = SELECTION_STATUSES.find(([key]) => key === status);
  return found ? found[1] : status;
}

// Pedido do usuario (17/09/2026): mostrar a data em que cada projeto de selecao foi adicionado,
// junto do seletor de etapa de cada card - aqui com hora tambem (formatDateTimePtBr), diferente
// da tabela de Entregas que so mostra dia/mes/ano (varios projetos de selecao podem ser criados
// no mesmo dia, a hora ajuda a diferenciar).
export async function selectionCasesListPage(req, res, admin) {
  const flash = readFlash(req);
  const cases = await Q.listSelectionCases();
  const columns = SELECTION_STATUSES.map(([key, label]) => {
    const items = cases.filter((c) => c.status === key);
    const cards = items.length
      ? items
          .map(
            (c) => `
        <div class="sel-card">
          <a href="/admin/selecao/${c.id}"><b>${escapeHtml(c.client_name)}</b></a>
          ${c.photo_limit ? `<span class="muted" style="font-size:.78rem;display:block;">Limite: ${c.photo_limit} fotos</span>` : ''}
          <span class="muted" style="font-size:.78rem;display:block;">Adicionado em ${escapeHtml(formatDateTimePtBr(c.created_at))}</span>
          <form method="post" action="/admin/selecao/${c.id}/mover-etapa" class="sel-move-form">
            <select name="status" onchange="this.form.submit()">
              ${SELECTION_STATUSES.map(([k, l]) => `<option value="${k}" ${k === c.status ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </form>
        </div>`
          )
          .join('')
      : '<p class="empty-hint">Nenhum projeto aqui.</p>';
    return `<div class="sel-column">
      <div class="sel-column-head"><h3>${label}</h3><span class="sel-count">${items.length}</span></div>
      <div class="sel-column-body">${cards}</div>
    </div>`;
  }).join('');

  const content = `
  <div class="panel-head" style="margin-bottom:18px;">
    <h2 style="margin:0;">Seleção de fotos</h2>
    <a class="btn-a btn-a-primary" href="/admin/selecao/novo">+ Novo projeto</a>
  </div>
  <div class="panel"><p class="muted" style="margin-top:0;">O cliente vê as fotos em baixa resolução com marca d'água, marca as favoritas e envia — você edita só as escolhidas depois. Mude a etapa pelo menu de cada card conforme o projeto andar.</p></div>
  <div class="sel-board">${columns}</div>`;
  res.end(adminLayout({ title: 'Seleção de fotos', activePath: '/admin/selecao', admin, content, flash }));
}

function selectionInfoForm({ action, selectionCase = {} }) {
  return `<form method="post" action="${action}">
    <div class="form-row">
      ${field({ label: 'Nome do cliente', name: 'client_name', value: selectionCase.client_name, required: true, placeholder: 'Ex: João & Maria' }).replace('<input', '<input data-slug-source')}
      ${field({ label: 'URL (slug)', name: 'slug', value: selectionCase.slug, help: 'Endereço final: /selecao/seu-texto-aqui' }).replace('<input', '<input data-slug-target')}
    </div>
    ${field({ label: 'Mensagem de boas-vindas (opcional)', name: 'welcome_message', value: selectionCase.welcome_message, textarea: true, rows: 4, placeholder: 'Ex: Escolha suas fotos favoritas! Assim que você enviar, já começo a editar.' })}
    ${field({ label: 'Limite de fotos (opcional)', name: 'photo_limit', type: 'number', value: selectionCase.photo_limit || '', help: 'Se o cliente passar desse número, ele só vê um aviso — não trava a seleção nem impede de enviar. Deixe em branco pra não ter limite.' })}
    <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Salvar</button></div>
  </form>`;
}

export async function selectionCaseNewPage(req, res, admin) {
  const content = `<div class="panel"><h2>Novo projeto de seleção</h2>${selectionInfoForm({ action: '/admin/selecao/criar' })}</div>`;
  res.end(adminLayout({ title: 'Novo projeto de seleção', activePath: '/admin/selecao', admin, content }));
}

export async function selectionCaseCreate(req, res, body) {
  const clientName = (body.client_name || '').trim();
  if (!clientName) return redirect(res, '/admin/selecao/novo');
  const slug = await uniqueSlug(['selection_cases'], (body.slug || '').trim() || clientName);
  const limit = body.photo_limit ? parseInt(body.photo_limit, 10) : null;
  const id = await Q.createSelectionCase({
    client_name: clientName,
    slug,
    welcome_message: body.welcome_message,
    photo_limit: Number.isFinite(limit) ? limit : null,
  });
  redirect(res, `/admin/selecao/${id}` + withFlash(res, 'success', 'Projeto criado! Agora suba as fotos.'));
}

function selectionTabs(id, active) {
  const tabs = [
    ['info', 'Informações'],
    ['fotos', 'Fotos'],
    ['revisao', 'Revisão'],
  ];
  return `<div class="tabs">${tabs
    .map(([key, label]) => `<a class="tab-link ${active === key ? 'active' : ''}" href="/admin/selecao/${id}${key === 'info' ? '' : '/' + key}">${label}</a>`)
    .join('')}</div>`;
}

// Gera o modal de exportação (igual referência do Alboom): abas por programa (só a instrução
// muda — a lista de nomes é a mesma embaixo), quebrada em "partes" pra não ficar um bloco de texto
// gigante de uma vez só. Os nomes vêm de original_filename (nome do arquivo tal como o fotógrafo
// enviou, ver server/upload.js) — é o que bate com os arquivos que já estão no computador dele.
function selectionExportModal(selectedPhotos) {
  const names = selectedPhotos.map((p) => p.original_filename || `foto-${p.id}`).filter(Boolean);
  const CHUNK = 40;
  const parts = [];
  for (let i = 0; i < names.length; i += CHUNK) parts.push(names.slice(i, i + CHUNK));
  const partsHtml = parts
    .map(
      (chunk, i) => `
    <div class="export-part">
      <div class="export-part-head"><span>Parte ${i + 1}</span><span class="muted">${chunk.length} fotos</span></div>
      <textarea readonly rows="3" data-export-part-text>${escapeHtml(chunk.join(', '))}</textarea>
      <button type="button" class="btn-a btn-a-sm" data-export-copy-btn>Copiar</button>
    </div>`
    )
    .join('');

  const platforms = [
    {
      key: 'lightroom',
      label: 'Lightroom',
      steps: [
        'No Lightroom, vá para o modo de Biblioteca',
        'Em "Filtro da biblioteca", filtre por "Texto"',
        'Selecione "Nome do arquivo" e "Contém"',
        'Copie e cole a lista abaixo no campo de busca',
      ],
    },
    {
      key: 'finder',
      label: 'Finder (Mac)',
      steps: [
        'Abra a pasta com as fotos originais no Finder',
        'Pressione Cmd+F e configure a busca por "Nome" → "contém"',
        'Cole os nomes da lista abaixo (um de cada vez, se o Finder não aceitar todos juntos)',
      ],
    },
    {
      key: 'win10',
      label: 'Windows 10',
      steps: [
        'Abra a pasta com as fotos originais no Explorador de Arquivos',
        'Clique na barra de busca, no canto superior direito',
        'Cole os nomes da lista abaixo (um de cada vez, se a busca não aceitar todos juntos)',
      ],
    },
    {
      key: 'win11',
      label: 'Windows 11',
      steps: [
        'Abra a pasta com as fotos originais no Explorador de Arquivos',
        'Clique na barra de busca, no canto superior direito',
        'Cole os nomes da lista abaixo (um de cada vez, se a busca não aceitar todos juntos)',
      ],
    },
  ];
  const tabsHtml = platforms
    .map((p, i) => `<button type="button" class="export-tab ${i === 0 ? 'active' : ''}" data-export-tab="${p.key}">${escapeHtml(p.label)}</button>`)
    .join('');
  const contentHtml = platforms
    .map(
      (p, i) => `
    <div class="export-tab-content" data-export-tab-content="${p.key}" ${i === 0 ? '' : 'hidden'}>
      <h4>Lista para ${escapeHtml(p.label)}</h4>
      <ul>${p.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
    </div>`
    )
    .join('');

  return `<div class="export-modal-overlay" data-export-modal-overlay hidden>
    <div class="export-modal">
      <div class="export-modal-head"><h3>Exportar fotos</h3><button type="button" class="export-modal-close" data-export-modal-close>×</button></div>
      <div class="export-tabs">${tabsHtml}</div>
      ${contentHtml}
      <div class="export-parts">${partsHtml}</div>
    </div>
  </div>`;
}

export async function selectionCaseEditPage(req, res, admin, id, tab = 'info') {
  const selectionCase = await Q.getSelectionCase(id);
  if (!selectionCase) return redirect(res, '/admin/selecao');
  const flash = readFlash(req);

  let body;
  if (tab === 'fotos') {
    body = `
    ${selectionTabs(id, 'fotos')}
    <div class="panel">
      <h2>Enviar fotos</h2>
      <p class="muted" style="margin-top:-8px;">As fotos aparecem pro cliente em baixa resolução e com marca d'água — só pra ele escolher, não pra usar de verdade. O nome original de cada arquivo fica guardado por baixo dos panos pra gerar a lista de exportação depois.</p>
      <div class="upload-drop" data-selection-upload-drop data-upload-url="/admin/selecao/${id}/fotos/upload">
        <input type="file" accept="image/*" multiple>
        <p>Clique aqui ou arraste as fotos para enviar</p>
        <div id="selection-upload-preview"></div>
        <p data-selection-upload-status style="margin-top:10px;font-size:0.82rem;"></p>
      </div>
    </div>
    <div class="panel">
      <h2>Fotos do projeto (${selectionCase.photos.length})</h2>
      ${selectionCase.photos.length
        ? `<div class="photo-grid">${selectionCase.photos
            .map(
              (p, i) => `<div class="photo-card">
          <img src="${escapeHtml(p.thumb_filename)}" alt="">
          <div class="pc-body">
            ${p.selected ? '<span class="is-cover-badge">♥ Selecionada</span>' : ''}
            <div class="pc-actions">
              <form method="post" action="/admin/selecao/${id}/fotos/${p.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="up"><button class="btn-a btn-a-sm" ${i === 0 ? 'disabled' : ''}>↑</button></form>
              <form method="post" action="/admin/selecao/${id}/fotos/${p.id}/mover" style="display:inline;"><input type="hidden" name="dir" value="down"><button class="btn-a btn-a-sm" ${i === selectionCase.photos.length - 1 ? 'disabled' : ''}>↓</button></form>
              <form method="post" action="/admin/selecao/${id}/fotos/${p.id}/excluir" data-confirm="Excluir esta foto?"><button class="btn-a btn-a-sm btn-a-danger">Excluir</button></form>
            </div>
          </div>
        </div>`
            )
            .join('')}</div>`
        : '<p class="empty-hint">Nenhuma foto enviada ainda.</p>'}
    </div>`;
  } else if (tab === 'revisao') {
    const selected = selectionCase.photos.filter((p) => p.selected);
    const hasSubmission = selectionCase.status === 'revisao' || selectionCase.status === 'finalizado';
    body = `
    ${selectionTabs(id, 'revisao')}
    ${!hasSubmission
      ? '<div class="panel"><p class="empty-hint">O cliente ainda não enviou a seleção. Assim que enviar, as fotos escolhidas aparecem aqui.</p></div>'
      : `
    <div class="panel">
      <div class="panel-head" style="margin-bottom:14px;">
        <h2 style="margin:0;">Fotos selecionadas (${selected.length}${selectionCase.photo_limit ? ` de ${selectionCase.photo_limit}` : ''})</h2>
        ${selected.length ? '<button type="button" class="btn-a btn-a-primary" data-export-modal-open>Exportar</button>' : ''}
      </div>
      ${selectionCase.submitted_at ? `<p class="muted" style="margin-top:0;">Enviada em ${escapeHtml(formatDateTimePtBr(selectionCase.submitted_at))}.</p>` : ''}
      ${selectionCase.client_note ? `<div class="panel" style="background:var(--a-panel-2);margin:0 0 14px;"><h3 style="margin-top:0;">Recado do cliente</h3><p style="white-space:pre-line;margin-bottom:0;">${escapeHtml(selectionCase.client_note)}</p></div>` : ''}
      ${selectionCase.photo_limit && selected.length > selectionCase.photo_limit ? `<p style="color:#d0503a;">Atenção: passou do limite combinado em ${selected.length - selectionCase.photo_limit} foto(s).</p>` : ''}
      ${selected.length ? `<div class="photo-grid">${selected.map((p) => `<div class="photo-card"><img src="${escapeHtml(p.thumb_filename)}" alt=""></div>`).join('')}</div>` : '<p class="empty-hint">O cliente enviou sem marcar nenhuma foto.</p>'}
    </div>
    <div class="panel">
      <h3>Etapa do projeto</h3>
      ${selectionCase.status === 'revisao'
        ? `<p class="muted">Revise as fotos selecionadas. Se estiver tudo certo, clique em finalizar. Caso seja necessária alguma alteração, você pode reativar a galeria para o cliente.</p>
        <div class="form-actions">
          <form method="post" action="/admin/selecao/${id}/mover-etapa" style="display:inline;"><input type="hidden" name="status" value="finalizado"><button class="btn-a btn-a-primary" type="submit">Finalizar</button></form>
          <form method="post" action="/admin/selecao/${id}/mover-etapa" style="display:inline;"><input type="hidden" name="status" value="andamento"><button class="btn-a" type="submit">Reativar galeria pro cliente</button></form>
        </div>`
        : `<p class="muted">Projeto finalizado ${selectionCase.finalized_at ? `em ${escapeHtml(formatDateTimePtBr(selectionCase.finalized_at))}` : ''}.</p>
        <form method="post" action="/admin/selecao/${id}/mover-etapa"><input type="hidden" name="status" value="andamento"><button class="btn-a" type="submit">Reativar galeria pro cliente</button></form>`}
    </div>
    ${selected.length ? selectionExportModal(selected) : ''}`}`;
  } else {
    body = `${selectionTabs(id, 'info')}<div class="panel"><h2>Informações</h2>${selectionInfoForm({ action: `/admin/selecao/${id}/atualizar`, selectionCase })}</div>
    <div class="panel">
      <h3>Etapa atual: ${escapeHtml(selectionStatusLabel(selectionCase.status))}</h3>
      <form method="post" action="/admin/selecao/${id}/mover-etapa">
        <div class="form-field">
          <label>Mudar etapa</label>
          <select name="status" onchange="this.form.submit()">
            ${SELECTION_STATUSES.map(([k, l]) => `<option value="${k}" ${k === selectionCase.status ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
      </form>
      ${selectionCase.status !== 'preparo'
        ? `<p><a href="${SITE_URL}/selecao/${escapeHtml(selectionCase.slug)}" target="_blank">${SITE_URL}/selecao/${escapeHtml(selectionCase.slug)}</a></p><p class="muted">Depois de mudar aqui, o site leva alguns instantes pra republicar antes do link refletir a mudança.</p>`
        : '<p class="muted">Assim que mudar a etapa pra "Em andamento", o link fica disponível pro cliente.</p>'}
    </div>
    <div class="panel">
      <h3>Excluir projeto</h3>
      <p class="muted">Essa ação remove o projeto e as fotos permanentemente.</p>
      <form method="post" action="/admin/selecao/${id}/excluir" data-confirm="Excluir o projeto de seleção de &quot;${escapeHtml(selectionCase.client_name)}&quot;?"><button class="btn-a btn-a-danger" type="submit">Excluir projeto</button></form>
    </div>`;
  }

  res.end(adminLayout({ title: selectionCase.client_name, activePath: '/admin/selecao', admin, content: body, flash }));
}

export async function selectionCaseUpdate(req, res, body, id) {
  const selectionCase = await Q.getSelectionCase(id);
  if (!selectionCase) return redirect(res, '/admin/selecao');
  const clientName = (body.client_name || selectionCase.client_name).trim();
  const slug = (body.slug || '').trim() ? await uniqueSlug(['selection_cases'], body.slug, id) : selectionCase.slug;
  const limit = body.photo_limit ? parseInt(body.photo_limit, 10) : null;
  await Q.updateSelectionCase(id, {
    client_name: clientName,
    slug,
    welcome_message: body.welcome_message,
    photo_limit: Number.isFinite(limit) ? limit : null,
  });
  redirect(res, `/admin/selecao/${id}` + withFlash(res, 'success', 'Projeto atualizado.'));
}

export async function selectionCaseMoveStatus(req, res, body, id) {
  const status = (body.status || '').trim();
  const valid = SELECTION_STATUSES.map(([k]) => k);
  if (!valid.includes(status)) return redirect(res, '/admin/selecao');
  if (status === 'revisao') await Q.markSelectionSubmitted(id);
  else if (status === 'finalizado') await Q.markSelectionFinalized(id);
  else if (status === 'andamento') await Q.reactivateSelectionCase(id);
  else await Q.setSelectionCaseStatus(id, status);
  redirect(res, `/admin/selecao/${id}`);
}

export async function selectionCaseDelete(req, res, id) {
  const photos = await Q.listSelectionPhotosForCase(id);
  for (const photo of photos) {
    try {
      await deleteSelectionPhotoFiles(photo.filename, photo.thumb_filename);
    } catch (err) {
      console.error('Erro ao apagar arquivo de foto de seleção:', err.message);
    }
  }
  await Q.deleteSelectionCase(id);
  redirect(res, '/admin/selecao' + withFlash(res, 'success', 'Projeto excluído.'));
}

export async function selectionPhotosUpload(req, res, body, id) {
  const selectionCase = await Q.getSelectionCase(id);
  if (!selectionCase) {
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
  let order = await maxSortOrder('selection_photos', 'case_id', id);
  let saved = 0;
  for (const item of photos) {
    try {
      const dataUrl = typeof item === 'string' ? item : item.data;
      const originalName = item && typeof item === 'object' ? item.name || '' : '';
      const { filename, thumbFilename, originalFilename, width, height } = await saveSelectionPhoto(dataUrl, originalName);
      order += 1;
      await Q.addSelectionPhoto(id, { filename, thumbFilename, originalFilename, sort_order: order, width, height });
      saved += 1;
    } catch (err) {
      console.error('Erro ao salvar foto de seleção:', err.message);
    }
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, saved }));
}

export async function selectionPhotoDelete(req, res, id, photoId) {
  const photo = await Q.getSelectionPhoto(photoId);
  if (photo) {
    await deleteSelectionPhotoFiles(photo.filename, photo.thumb_filename);
    await Q.deleteSelectionPhoto(photoId);
  }
  redirect(res, `/admin/selecao/${id}/fotos`);
}

export async function selectionPhotoMove(req, res, body, id, photoId) {
  const selectionCase = await Q.getSelectionCase(id);
  if (!selectionCase) return redirect(res, '/admin/selecao');
  const photos = selectionCase.photos;
  const idx = photos.findIndex((p) => p.id === photoId);
  if (idx === -1) return redirect(res, `/admin/selecao/${id}/fotos`);
  const swapWith = body.dir === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= photos.length) return redirect(res, `/admin/selecao/${id}/fotos`);
  const a = photos[idx], b = photos[swapWith];
  await Q.setSelectionPhotoOrder(a.id, b.sort_order);
  await Q.setSelectionPhotoOrder(b.id, a.sort_order);
  redirect(res, `/admin/selecao/${id}/fotos`);
}
