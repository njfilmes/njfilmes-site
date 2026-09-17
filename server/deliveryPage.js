// Página de entrega individual do cliente (/entregas/:slug) — gerada como HTML estático junto
// com o resto do site (ver scripts/build-static.js) sempre que uma entrega estiver marcada como
// "Publicada" no painel (/admin/entregas). Não usa o layout()/header/footer do site normal
// (server/render.js): é uma página própria, mais parecida com um convite/apresentação especial
// pro cliente — pedido do usuário em 12/09/2026 ("quero esse q fica 100% meu", depois de já ter
// aprovado esse visual numa ferramenta separada que dependia da conta do Claude).
//
// Reaproveita as mesmas funções de vídeo/escape do resto do site (server/util.js) em vez de ter
// uma versão própria — assim um link de Mega/Drive colado aqui tem exatamente o mesmo
// comportamento (embed automático, fallback, botão de tela cheia) que já existe na página de
// projeto do portfólio.
import { escapeHtml, videoEmbedHtml } from './util.js';

// Mesma variável de ambiente já usada pelo resto do site público (server/render.js) pra saber
// onde chamar a API de curtir/visualizar/comentários — o site é HTML estático, então essas
// chamadas via JS precisam saber o endereço do serviço do painel (que continua rodando à parte).
const PUBLIC_API_BASE = process.env.PUBLIC_API_BASE || '';

function waLink(number, message) {
  const digits = String(number || '').replace(/\D/g, '');
  if (!digits) return '';
  const text = encodeURIComponent(message || '');
  return `https://wa.me/${digits}${text ? `?text=${text}` : ''}`;
}

const CASE_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap');
  *{box-sizing:border-box;}
  html{scroll-behavior:smooth;}
  body{margin:0;background:#0b0a0d;color:#f1ede4;font-family:'Inter',system-ui,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased;}
  a{color:inherit;}
  .container{max-width:1080px;margin:0 auto;padding:0 24px;}
  .accent{color:#c9a227;}
  .reveal{opacity:0;transform:translateY(18px);transition:opacity .8s ease,transform .8s ease;}
  .reveal.is-visible{opacity:1;transform:none;}

  .dc-hero{min-height:78vh;display:flex;align-items:flex-end;position:relative;padding:80px 0 56px;background:#0b0a0d;overflow:hidden;}
  .dc-hero-bg{position:absolute;inset:0;background-size:cover;background-position:center;opacity:.55;}
  .dc-hero-bg::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,10,13,.35) 0%,rgba(11,10,13,.65) 55%,#0b0a0d 100%);}
  .dc-hero-inner{position:relative;z-index:1;}
  .dc-eyebrow{display:block;font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;color:rgba(241,237,228,.6);margin-bottom:14px;}
  .dc-title{font-family:'Fraunces',serif;font-weight:600;font-size:clamp(2.1rem,5.5vw,3.6rem);margin:0 0 18px;letter-spacing:-.01em;}
  .dc-welcome{max-width:640px;color:rgba(241,237,228,.82);font-size:1.05rem;white-space:pre-line;}

  section{padding:64px 0;}
  .dc-section-title{font-family:'Fraunces',serif;font-weight:600;font-size:1.7rem;margin:0 0 8px;}
  .dc-section-sub{color:rgba(241,237,228,.55);font-size:.92rem;margin:0 0 34px;}

  .video-grid{display:grid;gap:28px;}
  .video-block{background:#151319;border-radius:14px;overflow:hidden;border:1px solid rgba(241,237,228,.08);}
  .video-embed{position:relative;width:100%;aspect-ratio:16/9;background:#000;}
  .video-embed iframe,.video-embed video{position:absolute;inset:0;width:100%;height:100%;border:0;}
  .video-embed-fullscreen{position:absolute;right:10px;bottom:10px;z-index:2;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:6px;width:32px;height:32px;cursor:pointer;font-size:15px;}
  .video-embed-fallback{margin:0;padding:10px 16px;font-size:.8rem;color:rgba(241,237,228,.5);}
  .video-embed-linkonly{display:flex;align-items:center;justify-content:center;min-height:160px;}
  .video-block-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;}
  .video-block-title{font-weight:500;font-size:.95rem;}
  .video-download{display:inline-flex;align-items:center;gap:8px;background:#c9a227;color:#171310;font-weight:600;font-size:.85rem;padding:9px 16px;border-radius:100px;text-decoration:none;white-space:nowrap;}
  .video-download:hover{background:#dab643;}

  .gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;}
  .gallery-item{position:relative;border-radius:10px;overflow:hidden;aspect-ratio:4/5;cursor:zoom-in;background:#151319;transition:transform .35s ease;}
  .gallery-item:hover{transform:translateY(-6px);}
  .gallery-item img{width:100%;height:100%;object-fit:cover;display:block;}
  .gallery-item figcaption{position:absolute;left:0;right:0;bottom:0;padding:18px 12px 10px;font-size:.78rem;background:linear-gradient(0deg,rgba(0,0,0,.72),transparent);opacity:0;transition:opacity .25s ease;}
  .gallery-item:hover figcaption{opacity:1;}

  .download-section{text-align:center;background:#151319;border-radius:16px;border:1px solid rgba(241,237,228,.08);padding:48px 24px;}
  .download-btn{display:inline-flex;align-items:center;gap:10px;background:#c9a227;color:#171310;font-weight:600;padding:14px 30px;border-radius:100px;text-decoration:none;font-size:1rem;margin-top:18px;}
  .download-btn:hover{background:#dab643;}

  .lightbox{position:fixed;inset:0;background:rgba(6,5,7,.95);display:none;align-items:center;justify-content:center;z-index:50;padding:30px;}
  .lightbox.open{display:flex;}
  .lightbox img{max-width:100%;max-height:88vh;border-radius:6px;}
  .lightbox-close{position:absolute;top:22px;right:26px;background:none;border:0;color:#f1ede4;font-size:2rem;cursor:pointer;line-height:1;}

  .comment-section{max-width:620px;margin:0 auto;}
  .comment-list{display:flex;flex-direction:column;gap:16px;margin-bottom:30px;}
  .comment-item{background:#151319;border-radius:10px;padding:16px 18px;border:1px solid rgba(241,237,228,.08);}
  .comment-item b{display:block;font-size:.9rem;margin-bottom:4px;}
  .comment-item p{margin:0;font-size:.92rem;color:rgba(241,237,228,.85);}
  .comment-reply{margin-top:10px;padding-top:10px;border-top:1px dashed rgba(241,237,228,.15);font-size:.85rem;color:rgba(241,237,228,.65);}
  .comment-form{display:flex;flex-direction:column;gap:10px;}
  .comment-form input,.comment-form textarea{background:#151319;border:1px solid rgba(241,237,228,.15);border-radius:8px;padding:12px 14px;color:#f1ede4;font-family:inherit;font-size:.92rem;}
  .comment-form textarea{min-height:90px;resize:vertical;}
  .comment-btn{align-self:flex-start;background:#c9a227;color:#171310;border:0;font-weight:600;padding:11px 24px;border-radius:100px;cursor:pointer;font-size:.9rem;}
  .comment-btn:hover{background:#dab643;}
  .comment-status{font-size:.85rem;color:rgba(241,237,228,.6);min-height:1.2em;}
  .cf-hp{position:absolute;left:-9999px;opacity:0;height:0;width:0;}

  .dc-footer{text-align:center;padding:40px 0 60px;color:rgba(241,237,228,.4);font-size:.8rem;}
  .empty-hint{color:rgba(241,237,228,.45);font-size:.9rem;}
  @media (max-width:640px){section{padding:44px 0;} .dc-hero{padding:64px 0 40px;}}
`;

function pageScript(slug) {
  return `
  (function(){
    var els = document.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function(entries){
        entries.forEach(function(e){ if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } });
      }, { threshold: .15 });
      els.forEach(function(el){ io.observe(el); });
    } else {
      els.forEach(function(el){ el.classList.add('is-visible'); });
    }

    document.querySelectorAll('[data-video-fullscreen]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var frame = btn.parentElement.querySelector('iframe,video');
        if (frame && frame.requestFullscreen) frame.requestFullscreen();
      });
    });

    var lightbox = document.getElementById('dc-lightbox');
    var lightboxImg = lightbox ? lightbox.querySelector('img') : null;
    document.querySelectorAll('[data-lightbox-src]').forEach(function(item){
      item.addEventListener('click', function(){
        if (!lightbox) return;
        lightboxImg.src = item.getAttribute('data-lightbox-src');
        lightbox.classList.add('open');
      });
    });
    if (lightbox) {
      lightbox.addEventListener('click', function(e){
        if (e.target === lightbox || e.target.classList.contains('lightbox-close')) lightbox.classList.remove('open');
      });
    }

    var form = document.getElementById('dc-comment-form');
    if (form) {
      form.addEventListener('submit', function(e){
        e.preventDefault();
        var status = document.getElementById('dc-comment-status');
        var name = form.querySelector('[name=author_name]').value.trim();
        var content = form.querySelector('[name=content]').value.trim();
        if (!name || !content) { status.textContent = 'Preencha seu nome e o comentário.'; return; }
        status.textContent = 'Enviando...';
        fetch((window.NJFILMES_API_BASE || '') + '/api/entrega-comentarios/${slug}', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ author_name: name, content: content, empresa: form.querySelector('[name=empresa]').value })
        }).then(function(r){ return r.json(); }).then(function(data){
          if (!data.ok) { status.textContent = data.error || 'Não deu pra enviar, tenta de novo.'; return; }
          status.textContent = 'Comentário enviado, obrigado!';
          form.reset();
          var list = document.getElementById('dc-comment-list');
          if (list) {
            var empty = list.querySelector('.empty-hint');
            if (empty) empty.remove();
            var div = document.createElement('div');
            div.className = 'comment-item';
            div.innerHTML = '<b>' + name.replace(/[<>&]/g, function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c];}) + '</b><p></p>';
            div.querySelector('p').textContent = content;
            list.appendChild(div);
          }
        }).catch(function(){ status.textContent = 'Não deu pra enviar, tenta de novo.'; });
      });
    }
  })();
  `;
}

export function renderDeliveryCasePage(deliveryCase) {
  const c = deliveryCase;
  const otherPhotos = c.photos || [];
  const videos = c.videos || [];

  const videosHtml = videos.length
    ? `<section><div class="container">
        <h2 class="dc-section-title reveal">Vídeos</h2>
        <p class="dc-section-sub reveal">Uma prévia de como ficou — o arquivo completo está disponível pra download logo abaixo de cada vídeo.</p>
        <div class="video-grid">
          ${videos.map((v) => `
          <div class="video-block reveal">
            ${videoEmbedHtml(v)}
            ${v.title || v.download_url ? `<div class="video-block-foot">
              <span class="video-block-title">${escapeHtml(v.title || '')}</span>
              ${v.download_url ? `<a class="video-download" href="${escapeHtml(v.download_url)}" target="_blank" rel="noopener noreferrer">⭳ Baixar vídeo completo</a>` : ''}
            </div>` : ''}
          </div>`).join('')}
        </div>
      </div></section>`
    : '';

  const galleryHtml = otherPhotos.length
    ? `<section><div class="container">
        <h2 class="dc-section-title reveal">Fotos</h2>
        <p class="dc-section-sub reveal">Clique numa foto pra ver em tamanho maior.</p>
        <div class="gallery-grid">
          ${otherPhotos.map((p) => `
          <figure class="gallery-item reveal" data-lightbox-src="${escapeHtml(p.filename)}">
            <img src="${escapeHtml(p.thumb_filename)}" loading="lazy" alt="${escapeHtml(p.caption || '')}">
            ${p.caption ? `<figcaption>${escapeHtml(p.caption)}</figcaption>` : ''}
          </figure>`).join('')}
        </div>
      </div></section>`
    : '';

  const downloadHtml = c.photos_download_url
    ? `<section><div class="container">
        <div class="download-section reveal">
          <h2 class="dc-section-title" style="margin:0;">Quer as fotos em alta resolução?</h2>
          <p class="dc-section-sub" style="margin-bottom:0;">Baixe todas as fotos originais, sem compressão.</p>
          <a class="download-btn" href="${escapeHtml(c.photos_download_url)}" target="_blank" rel="noopener noreferrer">⭳ ${escapeHtml(c.photos_download_label || 'Baixar fotos em alta')}</a>
        </div>
      </div></section>`
    : '';

  const commentsHtml = `<section><div class="container comment-section">
      <h2 class="dc-section-title reveal" style="text-align:center;">Deixe seu comentário</h2>
      <p class="dc-section-sub reveal" style="text-align:center;">Gostou do resultado? Conta pra gente aqui embaixo.</p>
      <div class="comment-list reveal" id="dc-comment-list">
        ${(c.comments || []).length ? c.comments.map((cm) => `
        <div class="comment-item">
          <b>${escapeHtml(cm.author_name)}</b>
          <p>${escapeHtml(cm.content)}</p>
          ${cm.admin_reply ? `<div class="comment-reply">↳ <b>NJFILMES:</b> ${escapeHtml(cm.admin_reply)}</div>` : ''}
        </div>`).join('') : '<p class="empty-hint">Seja o primeiro a comentar.</p>'}
      </div>
      <form class="comment-form reveal" id="dc-comment-form">
        <input type="text" name="author_name" placeholder="Seu nome" maxlength="80" required>
        <textarea name="content" placeholder="Escreva seu comentário..." maxlength="1000" required></textarea>
        <input class="cf-hp" type="text" name="empresa" tabindex="-1" autocomplete="off">
        <button class="comment-btn" type="submit">Enviar comentário</button>
        <p class="comment-status" id="dc-comment-status"></p>
      </form>
    </div></section>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(c.client_name)} — NJFILMES</title>
${c.cover_photo ? `<meta property="og:image" content="${escapeHtml(c.cover_photo)}">` : ''}
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<style>${CASE_CSS}</style>
</head>
<body>
  <header class="dc-hero">
    ${c.cover_photo ? `<div class="dc-hero-bg" style="background-image:url('${escapeHtml(c.cover_photo)}')"></div>` : '<div class="dc-hero-bg"></div>'}
    <div class="container dc-hero-inner">
      <span class="dc-eyebrow reveal">NJ<span class="accent">FILMES</span> · Entrega</span>
      <h1 class="dc-title reveal">${escapeHtml(c.client_name)}</h1>
      ${c.welcome_message ? `<p class="dc-welcome reveal">${escapeHtml(c.welcome_message)}</p>` : ''}
    </div>
  </header>
  ${videosHtml}
  ${galleryHtml}
  ${downloadHtml}
  ${commentsHtml}
  <div class="dc-footer">Feito com carinho pela NJFILMES.</div>
  <div class="lightbox" id="dc-lightbox"><button class="lightbox-close" aria-label="Fechar">×</button><img src="" alt=""></div>
  <script>window.NJFILMES_API_BASE = ${JSON.stringify(PUBLIC_API_BASE)};</script>
  <script>${pageScript(c.slug)}</script>
</body>
</html>`;
}
