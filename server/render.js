// Camada de renderização (SSR simples, sem framework): layout base + helpers de SEO.
import { escapeHtml, truncate } from './util.js';

export const SITE_URL = process.env.SITE_URL || 'https://njfilmes.com.br';

export function absoluteUrl(pathOrUrl) {
if (!pathOrUrl) return SITE_URL;
if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
return SITE_URL.replace(/\/$/, '') + (pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`);
}

function waLink(settings) {
const digits = String(settings.whatsapp_number || '').replace(/\D/g, '');
if (!digits) return null;
const msg = encodeURIComponent(settings.whatsapp_message || 'Olá! Vim pelo site da NJFILMES.');
return `https://wa.me/${digits}?text=${msg}`;
}

export function layout({
title,
description,
path: routePath = '/',
ogImage,
settings,
categories = [],
bodyClass = '',
content,
structuredData = null,
noindex = false,
}) {
const fullTitle = title ? `${title} | ${settings.site_name || 'NJFILMES'}` : (settings.meta_title || 'NJFILMES');
const desc = truncate(description || settings.meta_description || '', 160);
const canonical = absoluteUrl(routePath);
const image = absoluteUrl(ogImage || settings.og_image || '/img/og-default.jpg');
const wa = waLink(settings);

const navCats = categories
.map(
(c) =>
`<li><a href="/portfolio/${escapeHtml(c.slug)}">${escapeHtml(c.name)}</a></li>`
)
.join('');

const socials = [
['Instagram', settings.instagram_url],
['YouTube', settings.youtube_url],
['Vimeo', settings.vimeo_url],
['TikTok', settings.tiktok_url],
['Facebook', settings.facebook_url],
]
.filter(([, url]) => url)
.map(([label, url]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`)
.join('');

return `<!DOCTYPE html>
<html lang="pt-BR" class="no-js">
<head>
<script>document.documentElement.classList.replace('no-js','js');</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : '<meta name="robots" content="index, follow">'}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(settings.site_name || 'NJFILMES')}">
<meta property="og:title" content="${escapeHtml(fullTitle)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:locale" content="pt_BR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(fullTitle)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&family=Hanken+Grotesk:wght@500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
${structuredData ? `<script type="application/ld+json">${JSON.stringify(structuredData)}</script>` : ''}
</head>
<body class="${escapeHtml(bodyClass)}">
<div class="noise-overlay" aria-hidden="true"></div>
<div class="grade-overlay" aria-hidden="true"></div>
<header class="site-header" data-header>
<div class="container header-inner">
<a href="/" class="logo logo-img"><img src="/img/nj-logo.png" alt="NJFILMES" class="logo-img-el"></a>
<nav class="main-nav" data-nav>
<button class="nav-close" data-nav-close type="button" aria-label="Fechar menu">
<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
</button>
<ul>
<li><a href="/">Home</a></li>
<li class="has-sub">
<a href="/portfolio">Portfólio</a>
${navCats ? `<ul class="sub-nav">${navCats}</ul>` : ''}
</li>
<li><a href="/sobre">Sobre</a></li>
<li><a href="/servicos">Serviços</a></li>
<li><a href="/contato">Contato</a></li>
</ul>
</nav>
<div class="nav-backdrop" data-nav-backdrop aria-hidden="true"></div>
<button class="nav-toggle" data-nav-toggle aria-label="Abrir menu" aria-expanded="false">
<span></span><span></span><span></span>
</button>
</div>
</header>

<main>
${content}
</main>

<footer class="site-footer">
<div class="container footer-inner">
<div class="footer-brand">
<a href="/" class="logo logo-img"><img src="/img/nj-logo.png" alt="NJFILMES" class="logo-img-el"></a>
<p>${escapeHtml(settings.footer_text || '')}</p>
</div>
<div class="footer-links">
<h4>Navegue</h4>
<ul>
<li><a href="/portfolio">Portfólio</a></li>
<li><a href="/sobre">Sobre</a></li>
<li><a href="/servicos">Serviços</a></li>
<li><a href="/contato">Contato</a></li>
<li><a href="/admin">Área administrativa</a></li>
</ul>
</div>
<div class="footer-social">
<h4>Redes sociais</h4>
<div class="social-links">${socials || '<span class="muted">—</span>'}</div>
${wa ? `<a class="btn btn-outline footer-wa" href="${escapeHtml(wa)}" target="_blank" rel="noopener noreferrer">Falar no WhatsApp</a>` : ''}
</div>
</div>
<div class="container footer-bottom">
<span>&copy; ${new Date().getFullYear()} ${escapeHtml(settings.site_name || 'NJFILMES')}. Todos os direitos reservados.</span>
</div>
</footer>

<button class="back-to-top" data-back-to-top type="button" aria-label="Voltar ao topo">
<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
</button>
${settings.instagram_url ? `<a href="${escapeHtml(settings.instagram_url)}" class="instagram-float" target="_blank" rel="noopener noreferrer" aria-label="Seguir no Instagram">
<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.5" y2="6.5"></line></svg>
</a>` : ''}
${wa ? `<a href="${escapeHtml(wa)}" class="whatsapp-float" target="_blank" rel="noopener noreferrer" aria-label="Falar no WhatsApp">
<svg viewBox="0 0 32 32" width="28" height="28" fill="currentColor"><path d="M16.001 3C9.373 3 4 8.373 4 15c0 2.42.71 4.673 1.936 6.573L4 29l7.627-1.906A11.94 11.94 0 0 0 16.001 27C22.628 27 28 21.627 28 15S22.628 3 16.001 3zm0 21.6c-1.98 0-3.822-.58-5.373-1.578l-.385-.243-4.53 1.132 1.16-4.415-.253-.397A9.55 9.55 0 0 1 5.4 15c0-5.85 4.75-10.6 10.6-10.6S26.6 9.15 26.6 15 21.85 24.6 16.001 24.6zm5.815-7.94c-.318-.16-1.883-.93-2.175-1.036-.292-.106-.505-.16-.717.16-.212.318-.823 1.036-1.01 1.248-.186.212-.372.24-.69.08-.318-.16-1.343-.495-2.558-1.578-.945-.842-1.583-1.883-1.768-2.2-.186-.318-.02-.49.14-.65.144-.143.318-.372.478-.558.16-.186.212-.318.318-.53.106-.212.053-.398-.027-.558-.08-.16-.717-1.727-.983-2.365-.259-.622-.522-.538-.717-.548-.186-.01-.398-.012-.61-.012-.212 0-.558.08-.85.398-.292.318-1.114 1.09-1.114 2.657 0 1.567 1.14 3.08 1.3 3.293.159.212 2.243 3.425 5.435 4.803.76.328 1.353.524 1.815.671.762.242 1.456.208 2.005.126.612-.091 1.883-.77 2.148-1.514.265-.743.265-1.38.186-1.514-.08-.133-.292-.212-.61-.372z"/></svg>
</a>` : ''}

<script src="/js/site.js" defer></script>
</body>
</html>`;
}
