// Layout do painel administrativo — simples, funcional, pensado para quem não programa.
import { escapeHtml } from './util.js';

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: '◆' },
  { href: '/admin/projetos', label: 'Projetos', icon: '▤' },
  { href: '/admin/categorias', label: 'Categorias', icon: '▦' },
  { href: '/admin/servicos', label: 'Serviços', icon: '✦' },
  { href: '/admin/marcas', label: 'Marcas', icon: '◈' },
  { href: '/admin/pessoas', label: 'Pessoas', icon: '☻' },
  { href: '/admin/links', label: 'Links externos', icon: '⛓' },
  { href: '/admin/bio', label: 'Biografia / Sobre', icon: '☺' },
  { href: '/admin/configuracoes', label: 'Configurações', icon: '⚙' },
];

export function adminLayout({ title, activePath, admin, content, flash = null }) {
  const nav = NAV_ITEMS.map((item) => {
    const active = activePath === item.href || (item.href !== '/admin' && activePath.startsWith(item.href));
    return `<a href="${item.href}" class="admin-nav-link ${active ? 'active' : ''}"><span class="ic">${item.icon}</span>${escapeHtml(item.label)}</a>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Admin NJFILMES</title>
<meta name="robots" content="noindex, nofollow">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/admin.css">
</head>
<body class="admin-body">
<div class="admin-shell">
  <aside class="admin-sidebar">
    <a href="/" class="admin-logo" target="_blank">NJ<span>FILMES</span></a>
    <nav class="admin-nav">${nav}</nav>
    <div class="admin-sidebar-footer">
      <div class="admin-user">${escapeHtml(admin?.name || admin?.email || '')}</div>
      <form method="post" action="/admin/logout"><button class="admin-link-btn" type="submit">Sair</button></form>
      <a href="/" target="_blank" class="admin-view-site">Ver site ↗</a>
    </div>
  </aside>
  <div class="admin-main">
    <header class="admin-topbar">
      <button class="admin-menu-toggle" data-admin-menu-toggle aria-label="Menu">☰</button>
      <h1>${escapeHtml(title)}</h1>
    </header>
    ${flash ? `<div class="admin-flash admin-flash-${flash.type}">${escapeHtml(flash.message)}</div>` : ''}
    <div class="admin-content">${content}</div>
  </div>
</div>
<script src="/js/admin.js" defer></script>
</body>
</html>`;
}

export function loginLayout({ title, content }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · NJFILMES</title>
<meta name="robots" content="noindex, nofollow">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/style.css">
<link rel="stylesheet" href="/css/admin.css">
</head>
<body class="admin-login-body">
  <div class="admin-login-box">
    <a href="/" class="logo" style="margin-bottom:28px;display:inline-block;">NJ<span>FILMES</span></a>
    ${content}
  </div>
</body>
</html>`;
}

// Helper para gerar campo de formulário simples (label + input) reduzindo repetição.
export function field({ label, name, value = '', type = 'text', required = false, textarea = false, rows = 4, placeholder = '', help = '' }) {
  const val = escapeHtml(value);
  const req = required ? 'required' : '';
  const input = textarea
    ? `<textarea name="${name}" rows="${rows}" placeholder="${escapeHtml(placeholder)}" ${req}>${val}</textarea>`
    : `<input type="${type}" name="${name}" value="${val}" placeholder="${escapeHtml(placeholder)}" ${req}>`;
  return `<div class="form-field">
    <label>${escapeHtml(label)}</label>
    ${input}
    ${help ? `<small>${escapeHtml(help)}</small>` : ''}
  </div>`;
}

export function checkboxField({ label, name, checked = false, help = '' }) {
  return `<div class="form-field form-check">
    <label><input type="checkbox" name="${name}" value="1" ${checked ? 'checked' : ''}> ${escapeHtml(label)}</label>
    ${help ? `<small>${escapeHtml(help)}</small>` : ''}
  </div>`;
}

export function selectField({ label, name, options, selected = '', help = '' }) {
  const opts = options
    .map((o) => `<option value="${escapeHtml(o.value)}" ${String(o.value) === String(selected) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`)
    .join('');
  return `<div class="form-field">
    <label>${escapeHtml(label)}</label>
    <select name="${name}">${opts}</select>
    ${help ? `<small>${escapeHtml(help)}</small>` : ''}
  </div>`;
}
