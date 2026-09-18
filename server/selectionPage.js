// Página pública de seleção de fotos (/selecao/:slug) — aba separada de "Entregas" (server/
// deliveryPage.js), pedido do usuário em 17/09/2026 inspirado no site Alboom: antes de editar de
// verdade, o cliente vê as fotos em baixa resolução e com marca d'água (ver server/upload.js,
// saveSelectionPhoto), marca as favoritas numa grade e envia — o fotógrafo edita só as escolhidas
// depois (painel: aba "Revisão" em /admin/selecao/:id/revisao, com lista pronta pra exportar pro
// Lightroom/Finder/Explorer). Ao contrário da entrega (formato "story", tela cheia), aqui é uma
// grade normal — o objetivo é comparar várias fotos lado a lado pra escolher, não "assistir" uma
// atrás da outra.
import { escapeHtml } from './util.js';
import { ASSET_VERSION } from './assetVersion.js';

const PUBLIC_API_BASE = process.env.PUBLIC_API_BASE || '';

const CASE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap');
*{box-sizing:border-box;}
body{margin:0;background:#0b0a0d;color:#f1ede4;font-family:'Inter',system-ui,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased;padding-bottom:96px;}
a{color:inherit;}
.container{max-width:1180px;margin:0 auto;padding:0 20px;}
.accent{color:#c9a227;}

.sl-header{padding:48px 0 28px;text-align:center;border-bottom:1px solid rgba(241,237,228,.08);}
.sl-brandmark img{height:28px;width:auto;display:block;margin:0 auto 18px;}
.sl-eyebrow{display:block;font-size:.76rem;letter-spacing:.14em;text-transform:uppercase;color:rgba(241,237,228,.55);margin-bottom:10px;}
.sl-title{font-family:'Fraunces',serif;font-weight:600;font-size:clamp(1.7rem,4.5vw,2.6rem);margin:0 0 14px;}
.sl-welcome{max-width:560px;margin:0 auto;color:rgba(241,237,228,.78);font-size:.98rem;white-space:pre-line;}

.sl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;padding:32px 0 40px;}
.sl-card{position:relative;border-radius:10px;overflow:hidden;background:#151319;aspect-ratio:1;cursor:pointer;user-select:none;-webkit-user-select:none;}
.sl-card img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;-webkit-user-drag:none;}
.sl-card.readonly{cursor:default;}
.sl-card-check{position:absolute;top:10px;right:10px;width:30px;height:30px;border-radius:50%;background:rgba(0,0,0,.55);border:2px solid rgba(255,255,255,.6);display:flex;align-items:center;justify-content:center;font-size:.95rem;padding:0;color:#fff;font-family:inherit;cursor:pointer;transition:background .2s ease,border-color .2s ease,transform .15s ease;}
.sl-card.is-selected .sl-card-check{background:#c9a227;border-color:#c9a227;color:#171310;transform:scale(1.08);}
.sl-card:active .sl-card-check{transform:scale(.92);}
.sl-card-zoom{position:absolute;top:10px;left:10px;width:30px;height:30px;border-radius:50%;background:rgba(0,0,0,.55);border:2px solid rgba(255,255,255,.6);display:flex;align-items:center;justify-content:center;color:#fff;padding:0;cursor:zoom-in;}
.sl-card-zoom:hover{background:rgba(0,0,0,.75);}
.sl-card-zoom svg{width:15px;height:15px;}

.sl-lightbox{position:fixed;inset:0;background:rgba(6,5,7,.95);display:none;align-items:center;justify-content:center;z-index:50;padding:30px;}
.sl-lightbox.open{display:flex;}
.sl-lightbox img{max-width:100%;max-height:88vh;border-radius:6px;}
.sl-lightbox-close{position:absolute;top:16px;right:18px;background:rgba(0,0,0,.55);border:2px solid rgba(255,255,255,.6);color:#f1ede4;font-size:.85rem;font-weight:600;cursor:pointer;line-height:1;display:flex;align-items:center;gap:6px;padding:9px 16px 9px 12px;border-radius:100px;}
.sl-lightbox-close:hover{background:rgba(0,0,0,.75);}
.sl-lightbox-close .sl-lightbox-close-icon{font-size:1.3rem;line-height:1;}
.sl-lightbox-select{position:absolute;bottom:30px;left:50%;transform:translateX(-50%);background:#c9a227;color:#171310;font-weight:600;font-size:.9rem;padding:11px 26px;border-radius:100px;border:0;cursor:pointer;display:flex;align-items:center;gap:8px;}
.sl-lightbox-select:hover{background:#dab643;}
.sl-lightbox-select.is-selected{background:#1f8a4c;color:#fff;}
@media (max-width:640px){.sl-lightbox{padding:16px;} .sl-lightbox-select{bottom:18px;padding:10px 20px;}}

.sl-bar{position:fixed;left:0;right:0;bottom:0;z-index:5;background:rgba(11,10,13,.94);backdrop-filter:blur(6px);border-top:1px solid rgba(241,237,228,.12);padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;}
.sl-bar-count{font-size:.92rem;}
.sl-bar-count b{font-family:'Fraunces',serif;font-size:1.1rem;}
.sl-bar-count.over{color:#e2a03f;}
.sl-bar button{background:#c9a227;color:#171310;font-weight:600;font-size:.9rem;padding:11px 24px;border-radius:100px;border:0;cursor:pointer;white-space:nowrap;}
.sl-bar button:hover{background:#dab643;}
.sl-bar button:disabled{opacity:.5;cursor:default;}
.sl-status{font-size:.85rem;color:rgba(241,237,228,.6);min-height:1.2em;}

.sl-note{max-width:640px;margin:0 auto 24px;padding:0 20px;}
.sl-note label{display:block;font-size:.85rem;color:rgba(241,237,228,.65);margin-bottom:8px;}
.sl-note textarea{width:100%;background:#151319;border:1px solid rgba(241,237,228,.15);border-radius:8px;color:#f1ede4;font-family:inherit;font-size:.92rem;padding:12px 14px;resize:vertical;min-height:70px;}
.sl-note textarea:focus{outline:none;border-color:#c9a227;}

.sl-done{max-width:520px;margin:60px auto;text-align:center;padding:0 20px;}
.sl-done h2{font-family:'Fraunces',serif;font-weight:600;font-size:1.6rem;margin:0 0 12px;}
.sl-done p{color:rgba(241,237,228,.75);}

.sl-footer{text-align:center;padding:16px 0 50px;color:rgba(241,237,228,.4);font-size:.8rem;}
.sl-footer img{height:24px;width:auto;margin:0 auto 8px;display:block;}

@media (max-width:640px){.sl-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;}}
`;

function pageScript(slug, limit) {
return `
(function(){
var apiBase = window.NJFILMES_API_BASE || '';
var cards = document.querySelectorAll('[data-sl-card]');
var countEl = document.querySelector('[data-sl-count]');
var statusEl = document.querySelector('[data-sl-status]');
var sendBtn = document.querySelector('[data-sl-send]');
var limit = ${JSON.stringify(limit || null)};

function updateCount() {
var n = document.querySelectorAll('[data-sl-card].is-selected').length;
if (!countEl) return;
var text = limit ? (n + ' de ' + limit + ' selecionadas') : (n + ' selecionada' + (n === 1 ? '' : 's'));
countEl.textContent = text;
countEl.classList.toggle('over', Boolean(limit) && n > limit);
}
updateCount();

// Pedido do usuário (18/09/2026): antes, clicar em qualquer parte da foto já marcava ela
// como favorita, e só o ícone de lupa no canto abria a foto ampliada — só que no PC o
// usuário esperava o contrário ("só abre [a foto ampliada] se clicar na seta [a lupa]").
// Agora é: clicar no CORPO da foto abre ela ampliada (a lupa faz a mesma coisa, é só um
// reforço visual pra quem não sabe que a foto toda é clicável); só o coração no canto marca
// ou desmarca como favorita diretamente na grade, sem precisar abrir a foto.
function toggleSelect(card) {
if (card.classList.contains('readonly')) return;
var photoId = card.dataset.photoId;
var willSelect = !card.classList.contains('is-selected');
card.classList.toggle('is-selected', willSelect);
updateCount();
fetch(apiBase + '/api/selecao-marcar/' + photoId, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ selected: willSelect }),
}).catch(function () {});
}

document.querySelectorAll('[data-sl-check]').forEach(function (checkBtn) {
checkBtn.addEventListener('click', function (e) {
e.preventDefault();
e.stopPropagation();
var card = checkBtn.closest('[data-sl-card]');
if (card) toggleSelect(card);
});
});

// "Ver foto inteira" — pedido do usuário em 17/09/2026: a grade corta a foto em quadrado
// pra ficar organizada, mas o cliente não tinha como ver ela inteira antes de escolher. O
// ícone de lupa (e agora também clicar em qualquer parte da foto) abre uma tela cheia com a
// foto sem cortar (mesma marca d'água/resolução baixa de sempre) - a seleção fica só por
// conta do coração no card ou do botão "Selecionar" de dentro da tela cheia.
var lightbox = document.querySelector('[data-sl-lightbox]');
var lightboxImg = lightbox ? lightbox.querySelector('img') : null;
var lightboxSelectBtn = lightbox ? lightbox.querySelector('[data-sl-lightbox-select]') : null;
var lightboxSelectLabel = lightboxSelectBtn ? lightboxSelectBtn.querySelector('[data-sl-lightbox-select-label]') : null;
var zoomCard = null;

function refreshLightboxSelectBtn() {
if (!lightboxSelectBtn || !zoomCard) return;
var isSel = zoomCard.classList.contains('is-selected');
lightboxSelectBtn.classList.toggle('is-selected', isSel);
if (lightboxSelectLabel) lightboxSelectLabel.textContent = isSel ? 'Selecionada ✓' : 'Selecionar';
}

// Suporte ao botão/gesto de voltar do celular — pedido do usuário em 18/09/2026: antes,
// só o "×" fechava a foto ampliada; apertar voltar no Android saía direto da página de
// seleção. Agora, abrir a foto empilha um estado no histórico, e apertar voltar (ou o
// botão "Voltar" na tela) só fecha a foto ampliada, sem sair da página.
var lightboxHistoryPushed = false;

function openLightbox(card) {
if (!lightbox || !lightboxImg) return;
zoomCard = card;
var img = card.querySelector('img');
lightboxImg.src = img ? img.src : '';
refreshLightboxSelectBtn();
lightbox.classList.add('open');
if (!lightboxHistoryPushed) {
history.pushState({ slLightbox: true }, '');
lightboxHistoryPushed = true;
}
}

function closeLightbox() {
lightbox.classList.remove('open');
zoomCard = null;
if (lightboxHistoryPushed) {
lightboxHistoryPushed = false;
history.back();
}
}

window.addEventListener('popstate', function () {
if (lightbox && lightbox.classList.contains('open')) {
lightbox.classList.remove('open');
zoomCard = null;
lightboxHistoryPushed = false;
}
});

cards.forEach(function (card) {
card.addEventListener('click', function () {
openLightbox(card);
});
});

document.querySelectorAll('[data-sl-zoom]').forEach(function (btn) {
btn.addEventListener('click', function (e) {
e.preventDefault();
e.stopPropagation();
var card = btn.closest('[data-sl-card]');
if (card) openLightbox(card);
});
});

if (lightbox) {
lightbox.addEventListener('click', function (e) {
if (e.target === lightbox || e.target.closest('[data-sl-lightbox-close]')) {
closeLightbox();
}
});
}

if (lightboxSelectBtn) {
lightboxSelectBtn.addEventListener('click', function (e) {
e.stopPropagation();
if (!zoomCard) return;
toggleSelect(zoomCard);
refreshLightboxSelectBtn();
});
}

if (sendBtn) {
var noteEl = document.querySelector('[data-sl-note]');
sendBtn.addEventListener('click', function () {
sendBtn.disabled = true;
if (statusEl) statusEl.textContent = 'Enviando...';
fetch(apiBase + '/api/selecao-enviar/' + ${JSON.stringify(slug)}, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ note: noteEl ? noteEl.value : '' }),
})
.then(function (r) { return r.json(); })
.then(function (data) {
if (data && data.ok) {
window.location.reload();
} else {
sendBtn.disabled = false;
if (statusEl) statusEl.textContent = (data && data.error) || 'Não deu pra enviar agora. Tente de novo.';
}
})
.catch(function () {
sendBtn.disabled = false;
if (statusEl) statusEl.textContent = 'Não deu pra enviar agora. Tente de novo.';
});
});
}
})();
`;
}

export function renderSelectionCasePage(selectionCase, settings = {}) {
const c = selectionCase;
const photos = c.photos || [];
const isLocked = c.status === 'revisao' || c.status === 'finalizado';
const selected = photos.filter((p) => p.selected);

const zoomIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;

const gridHtml = (isLocked ? selected : photos)
.map(
(p) => `<div class="sl-card${isLocked ? ' readonly' : ''}${p.selected ? ' is-selected' : ''}" data-sl-card data-photo-id="${p.id}">
<img src="${escapeHtml(p.filename)}" loading="lazy" alt="">
<button type="button" class="sl-card-zoom" data-sl-zoom aria-label="Ver foto inteira">${zoomIconSvg}</button>
${isLocked ? '<span class="sl-card-check">✓</span>' : `<button type="button" class="sl-card-check" data-sl-check aria-label="Marcar como favorita">♥</button>`}
</div>`
)
.join('');

const bodyContent = isLocked
? `<div class="sl-done">
<h2>Seleção enviada!</h2>
<p>Você escolheu ${selected.length} foto${selected.length === 1 ? '' : 's'}. Já estamos editando — assim que ficar pronto, você recebe o link com as fotos finais.</p>
${c.client_note ? `<p style="white-space:pre-line;"><em>Seu recado: "${escapeHtml(c.client_note)}"</em></p>` : ''}
</div>
${selected.length ? `<div class="container"><div class="sl-grid">${gridHtml}</div></div>` : ''}`
: `<div class="container">
<div class="sl-grid">${gridHtml || '<p class="empty-hint" style="grid-column:1/-1;color:rgba(241,237,228,.5);">Nenhuma foto disponível ainda.</p>'}</div>
</div>
<div class="sl-note">
<label for="sl-note-input">Quer deixar algum recado? (opcional)</label>
<textarea id="sl-note-input" data-sl-note rows="3" placeholder="Ex: essas 3 primeiras são pra moldura, gostaria dessa em preto e branco..."></textarea>
</div>
<div class="sl-bar">
<span class="sl-bar-count" data-sl-count></span>
<div style="display:flex;align-items:center;gap:14px;">
<span class="sl-status" data-sl-status></span>
<button type="button" data-sl-send>Enviar seleção</button>
</div>
</div>`;

return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Seleção de fotos · ${escapeHtml(c.client_name)} · NJFILMES</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<style>${CASE_CSS}</style>
</head>
<body>
<div class="sl-header">
<span class="sl-brandmark"><img src="/img/nj-logo.webp?v=${ASSET_VERSION}" alt="NJFILMES"></span>
<span class="sl-eyebrow">NJ<span class="accent">FILMES</span> · Seleção de fotos</span>
<h1 class="sl-title">${escapeHtml(c.client_name)}</h1>
${c.welcome_message ? `<p class="sl-welcome">${escapeHtml(c.welcome_message)}</p>` : '<p class="sl-welcome">Toque no coração de cada foto pra marcar como favorita — depois é só enviar. Clique na foto pra ver ela ampliada.</p>'}
</div>
${bodyContent}
<div class="sl-lightbox" data-sl-lightbox>
<button type="button" class="sl-lightbox-close" data-sl-lightbox-close aria-label="Voltar"><span class="sl-lightbox-close-icon" aria-hidden="true">‹</span> Voltar</button>
<img src="" alt="">
${isLocked ? '' : `<button type="button" class="sl-lightbox-select" data-sl-lightbox-select><span data-sl-lightbox-select-label>Selecionar</span></button>`}
</div>
<div class="sl-footer">
<img src="/img/nj-logo.webp?v=${ASSET_VERSION}" alt="NJFILMES">
Feito com carinho pela NJFILMES.
</div>
<script>window.NJFILMES_API_BASE = ${JSON.stringify(PUBLIC_API_BASE)};</script>
<script>${pageScript(c.slug, c.photo_limit)}</script>
</body>
</html>`;
}
