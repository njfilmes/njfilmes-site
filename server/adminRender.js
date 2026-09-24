// Layout do painel administrativo — simples, funcional, pensado para quem não programa.
import { escapeHtml } from './util.js';

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: '◆' },
  { href: '/admin/menu', label: 'Menu do site', icon: '☰' },
  { href: '/admin/projetos', label: 'Projetos', icon: '▤' },
  { href: '/admin/entregas', label: 'Entregas', icon: '↗' },
  { href: '/admin/selecao', label: 'Seleção', icon: '♥' },
  { href: '/admin/categorias', label: 'Categorias', icon: '▦' },
  { href: '/admin/servicos', label: 'Serviços', icon: '✦' },
  { href: '/admin/marcas', label: 'Marcas', icon: '◈' },
  { href: '/admin/pessoas', label: 'Pessoas', icon: '☻' },
  { href: '/admin/depoimentos', label: 'Depoimentos', icon: '▶' },
  { href: '/admin/comentarios', label: 'Comentários', icon: '✉' },
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
<!-- Pedido em 10/09/2026: painel admin tambem com a fonte Poppins (mesma do site publico),
     usada no logo e nos numeros dos cards de estatistica (server/routes/admin.js, admin.css). -->
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Poppins:wght@700&display=swap" rel="stylesheet">
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
    ${flash ? `<div class="admin-flash admin-flash-${escapeHtml(flash.type)}">${escapeHtml(flash.message)}</div>` : ''}
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
<!-- Pedido em 10/09/2026: Bebas Neue trocada por Poppins aqui tambem (login), pra combinar
     com o resto do site/painel - ver admin.css (.admin-logo). -->
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@700&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
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
    if (type === 'color') {
          // 24/09/2026: um <input type="color"> nativo nunca fica "vazio" - o navegador sempre manda
          // um hex válido ao salvar o formulário, e se o campo começar em branco ele assume preto
          // (#000000) sozinho. Sem esse cuidado, bastava salvar as Configurações uma vez (mesmo
          // mexendo só em outro campo) pra esse preto ser gravado e apagar sem querer a cor padrão
          // do site inteiro. Por isso o valor real (que PODE ficar vazio = "usar a cor padrão") mora
          // num campo escondido; o seletor de cor visível só serve pra escolher uma cor nova, e o
          // botão "Usar cor padrão" limpa o campo escondido de volta pro vazio sem mexer no resto.
          const fallback = placeholder || '#000000';
          const swatchValue = escapeHtml(value || fallback);
          const input = `<div class="color-field" style="display:flex;align-items:center;gap:10px;">
                <input type="hidden" name="${name}" value="${val}" data-color-hidden>
                      <input type="color" value="${swatchValue}" data-color-picker aria-label="${escapeHtml(label)}">
                            <button type="button" class="btn-a btn-a-sm" data-color-clear>Usar cor padrão</button>
                                </div>
                                    <script>
                                          (function(){
                                                  var scripts = document.getElementsByTagName('script');
                                                          var wrap = scripts[scripts.length - 1].previousElementSibling;
                                                                  var hidden = wrap.querySelector('[data-color-hidden]');
                                                                          var picker = wrap.querySelector('[data-color-picker]');
                                                                                  var clearBtn = wrap.querySelector('[data-color-clear]');
                                                                                          picker.addEventListener('input', function () { hidden.value = picker.value; });
                                                                                                  clearBtn.addEventListener('click', function () {
                                                                                                            hidden.value = '';
                                                                                                                      picker.value = ${JSON.stringify(fallback)};
                                                                                                                              });
                                                                                                                                    })();
                                                                                                                                        </script>`;
          return `<div class="form-field">
                <label>${escapeHtml(label)}</label>
                      ${input}
                            ${help ? `<small>${escapeHtml(help)}</small>` : ''}
                                </div>`;
    }
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
