// Página de entrega individual do cliente (/entregas/:slug) — gerada como HTML estático junto
// com o resto do site (ver scripts/build-static.js) sempre que uma entrega estiver marcada como
// "Publicada" no painel (/admin/entregas). Não usa o layout()/header/footer do site normal
// (server/render.js): é uma página própria, mais parecida com um convite/apresentação especial
// pro cliente — pedido do usuário em 12/09/2026 ("quero esse q fica 100% meu", depois de já ter
// aprovado esse visual numa ferramenta separada que dependia da conta do Claude).
//
// Redesenhada em 17/09/2026 no formato "story" (tela cheia, uma foto/vídeo por vez, rolagem com
// encaixe e numeração) — pedido do usuário depois de mandar como referência a entrega de outro
// fotógrafo (GOGO Produção): cada foto/vídeo ocupa a tela toda, com legenda só quando a foto tem
// uma (campo já existente `photos.caption`), numeração discreta no canto, e as animações de
// entrada (`.reveal`) e o gancho de "role para ver" no topo. Continua usando os mesmos dados do
// painel de sempre (nada mudou na hora de cadastrar fotos/vídeos/link de download) — só a
// apresentação final ficou mais parecida com uma apresentação/convite do que com uma página de
// site comum.
//
// Reaproveita as mesmas funções de vídeo/escape do resto do site (server/util.js) em vez de ter
// uma versão própria — assim um link de Mega/Drive colado aqui tem exatamente o mesmo
// comportamento (embed automático, fallback, botão de tela cheia) que já existe na página de
// projeto do portfólio.
import { escapeHtml, videoEmbedHtml } from './util.js';
import { ASSET_VERSION } from './assetVersion.js';

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
  /* Pedido do usuario (17/09/2026): "coloca o maximo de animacao possivel" - entrada mais forte
     (vinha de mais longe + começava um pouco menor) e mais lenta/suave, pra ficar bem mais
     perceptível ao rolar até cada seção. */
  .reveal{opacity:0;transform:translateY(34px) scale(.95);transition:opacity 1.1s cubic-bezier(.16,.84,.44,1),transform 1.1s cubic-bezier(.16,.84,.44,1);}
  .reveal.is-visible{opacity:1;transform:none;}

  /* ---- Área "story": capa + uma foto/vídeo por tela, com rolagem que encaixa ---- */
  /* Pedido do usuario (17/09/2026): "a rolagem do pc ta estranha, tem outra rolagem do lado" -
     antes só a capa+fotos/vídeos ficavam dentro de ".dc-story" (que rola por conta própria) e o
     download/comentários/rodapé vinham soltos depois, deixando a página (html/body) rolar TAMBÉM
     por conta própria - duas rolagens ao mesmo tempo. Agora ".dc-story" engloba a página inteira
     (ver renderDeliveryCasePage mais abaixo) e html/body ficam travados do tamanho exato da tela
     (".dc-locked", só quando existe foto/vídeo) - sobra uma única barra de rolagem. */
  html.dc-locked, body.dc-locked{height:100vh;height:100dvh;overflow:hidden;margin:0;}
  /* Pedido do usuario (17/09/2026): "ao fazer a rolagem ele ta subindo sem deixar aparecer o
     final aonde tem pra baixar" - com "mandatory" o navegador é obrigado a sempre parar exatamente
     em cima de um ponto de encaixe (scroll-snap-align), e o download/comentários/rodapé (que vêm
     depois do último slide) não eram pontos de encaixe - então, ao tentar rolar pra ver essas
     seções, o encaixe "mandatory" forçava voltar pro último slide de foto/vídeo em vez de deixar
     ir até o final. Primeira tentativa foi trocar pra "proximity", mas isso trouxe um problema
     novo ("continua meio travando ao deslizar tanto no cel quanto no pc") - sem "mandatory" a
     rolagem podia parar NO MEIO do caminho entre duas fotos (nem uma nem outra), parecendo
     emperrada. Solução de verdade: manter "mandatory" (sempre encaixa em algum lugar, nunca fica
     no meio) e dar um ponto de encaixe de verdade pro download/comentários/rodapé também
     (".dc-story > section, .dc-story > .dc-footer" aqui embaixo) - assim o encaixe obrigatório
     para NELES em vez de forçar voltar pro último slide. */
  .dc-story{scroll-snap-type:y mandatory;scroll-behavior:smooth;overflow-y:auto;-webkit-overflow-scrolling:touch;height:100vh;height:100dvh;}
  .dc-story > section, .dc-story > .dc-footer{scroll-snap-align:start;}

  .dc-cover{scroll-snap-align:start;scroll-snap-stop:always;min-height:100vh;min-height:100dvh;display:flex;align-items:flex-end;position:relative;padding:80px 0 64px;background:#0b0a0d;overflow:hidden;}
  /* Pedido do usuario (17/09/2026): "os efeitos n ta aparecendo ta tudo estatico" - capa e
     fotos/vídeos da entrega eram uma imagem 100% parada, sem nenhum movimento (diferente do hero
     da Home, que já tem um zoom lento contínuo - ".hero-media img" em style.css). Mesma ideia
     aqui: um zoom bem lento e suave, vai-e-volta, só pra tirar a sensação de "imagem congelada". */
  /* Pedido do usuario (17/09/2026): "e tinha animacao de zoom... e no q vc fez n tem" + referência
     mandada (entrega da GOGO Produção) - lá a foto de fundo aparece bem viva/colorida, quase sem
     escurecer, só um degradê suave embaixo pro texto não brigar com a foto. Aqui a foto ficava
     "lavada" o tempo todo (opacity:.55 por cima dela inteira) - tirado isso, a foto agora aparece
     quase 100% (opacity:.94) e quem cuida da legibilidade do texto é só o degradê (::after logo
     abaixo, mais forte perto do topo pra não brigar com a marca/etiqueta).  */
  .dc-cover-bg{position:absolute;inset:0;background-size:cover;background-position:center;opacity:.94;transform:scale(1);animation:dcKenBurns 12s ease-in-out infinite alternate;}
  .dc-cover-bg::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,10,13,.45) 0%,rgba(11,10,13,.3) 30%,rgba(11,10,13,.72) 62%,#0b0a0d 100%);}
  .dc-cover-inner{position:relative;z-index:1;}
  .dc-brandmark{position:absolute;top:22px;left:24px;z-index:2;display:block;}
  .dc-brandmark img{height:30px;width:auto;display:block;}
  .dc-eyebrow{display:block;font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;color:rgba(241,237,228,.6);margin-bottom:14px;}
  .dc-title{font-family:'Fraunces',serif;font-weight:600;font-size:clamp(2.1rem,5.5vw,3.6rem);margin:0 0 18px;letter-spacing:-.01em;}
  .dc-welcome{max-width:640px;color:rgba(241,237,228,.82);font-size:1.05rem;white-space:pre-line;}
  /* Pedido do usuario (17/09/2026): na referência que mandou, o "role para ver" vem com um
     tracinho HORIZONTAL do lado ("— ROLE PARA VER"), não uma linha vertical em cima do texto como
     estava aqui - ajustado pra bater com a referência, e o tracinho ganhou um leve deslizar de
     lado a lado (mais uma animação, já que a ideia é ter o máximo possível). */
  .dc-scroll-hint{position:absolute;left:24px;bottom:26px;z-index:2;display:flex;align-items:center;gap:10px;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:rgba(241,237,228,.55);}
  .dc-scroll-hint::before{content:'';width:26px;height:1px;background:rgba(241,237,228,.6);animation:dcScrollDash 1.8s ease-in-out infinite;}
  @keyframes dcScrollDash{0%,100%{transform:scaleX(.55) translateX(0);opacity:.4;}50%{transform:scaleX(1) translateX(3px);opacity:1;}}

  .dc-slide{scroll-snap-align:start;scroll-snap-stop:always;position:relative;}
  .dc-slide-media{height:100vh;height:100dvh;position:relative;overflow:hidden;background:#151319;}
  .dc-slide-media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in;}
  /* Foto horizontal (paisagem) dentro do formato vertical em tela cheia: em vez de cortar as
     laterais pra preencher a tela toda (object-fit:cover), mostra ela inteira (contain) com um
     fundo desfocado da própria foto atrás — pedido do usuário em 17/09/2026 ("a foto horizontal
     tá ficando vertical e cortando as laterais"). Foto vertical/quadrada continua exatamente
     como antes (cover, tela cheia, sem essa camada de fundo). */
  .dc-slide-media-bg{position:absolute;inset:0;background-size:cover;background-position:center;filter:blur(38px) brightness(.55);transform:scale(1.15);animation:dcSlideBgZoom 12s ease-in-out infinite alternate;}
  .dc-slide-media.is-landscape img{object-fit:contain;}
  /* Pedido do usuario (17/09/2026): "tinha animacao de zoom em cada imagem... no que vc fez n
     tem, coloca o maximo de animacao possivel" - duas correções: (1) antes o zoom só rodava nas
     fotos verticais/quadradas (":not(.is-landscape) img") - a maioria das fotos reais (esse caso
     de teste incluso) é horizontal, então na prática quase nenhuma foto tinha zoom nenhum, só o
     fundo desfocado atrás dela (".dc-slide-media-bg" ali em cima). Agora TODA foto/vídeo tem zoom,
     landscape incluso. (2) o efeito também ficou mais forte e mais rápido (12s em vez de 18s, zoom
     maior), e ganhou um leve movimento de câmera (translate) junto, não só zoom parado no centro -
     alterna a direção a cada foto (ímpar/par) pra não ficar repetitivo. */
  .dc-slide:nth-child(odd) .dc-slide-media img{animation:dcKenBurnsA 12s ease-in-out infinite alternate;}
  .dc-slide:nth-child(even) .dc-slide-media img{animation:dcKenBurnsB 14s ease-in-out infinite alternate;}
  @keyframes dcKenBurns{from{transform:scale(1);}to{transform:scale(1.14);}}
  @keyframes dcKenBurnsA{from{transform:scale(1) translate(0,0);}to{transform:scale(1.18) translate(-2.4%,-1.8%);}}
  @keyframes dcKenBurnsB{from{transform:scale(1.04) translate(1.6%,1%);}to{transform:scale(1.2) translate(-1.2%,-2.2%);}}
  @keyframes dcSlideBgZoom{from{transform:scale(1.15);}to{transform:scale(1.32);}}
  @media (prefers-reduced-motion: reduce){
    .dc-cover-bg, .dc-slide-media-bg, .dc-slide-media img{animation:none;}
  }
  .dc-slide-media .dc-story-video{position:absolute;inset:0;background:#000;}
  .dc-slide-media .dc-story-video iframe,.dc-slide-media .dc-story-video video{position:absolute;top:50%;left:50%;width:100vw;height:56.25vw;min-height:100%;min-width:177.78vh;transform:translate(-50%,-50%);border:0;object-fit:cover;}
  .dc-slide-media::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,transparent 60%,rgba(0,0,0,.6) 100%);pointer-events:none;}
  .dc-slide-top-text{position:absolute;top:0;left:0;right:0;z-index:2;padding:34px 24px 70px;text-align:center;background:linear-gradient(180deg,rgba(0,0,0,.55) 0%,transparent 100%);pointer-events:none;}
  .dc-slide-top-text p{margin:0;font-family:'Fraunces',serif;font-weight:500;font-style:italic;font-size:1.2rem;color:#f1ede4;text-shadow:0 2px 10px rgba(0,0,0,.5);max-width:600px;margin:0 auto;}
  .dc-slide-number{position:absolute;left:22px;bottom:18px;z-index:2;font-family:'Fraunces',serif;font-size:.85rem;letter-spacing:.08em;color:rgba(241,237,228,.8);}
  .dc-like-btn{position:absolute;right:16px;bottom:16px;z-index:3;display:inline-flex;align-items:center;gap:7px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.25);color:#f1ede4;border-radius:999px;padding:9px 16px;font-family:inherit;font-size:.88rem;cursor:pointer;transition:border-color .25s ease,color .25s ease,transform .15s ease;}
  .dc-like-btn:hover{border-color:#c9a227;color:#c9a227;}
  .dc-like-btn:active{transform:scale(.94);}
  .dc-like-btn.liked{border-color:#c9a227;color:#c9a227;background:rgba(201,162,39,.22);}
  .dc-like-btn .heart{font-size:1rem;line-height:1;}
  .dc-like-btn .heart::before{content:'♡';}
  .dc-like-btn.liked .heart::before{content:'♥';}
  .dc-like-btn--video{right:64px;}
  .video-embed-fullscreen{position:absolute;right:16px;bottom:16px;z-index:2;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:6px;width:32px;height:32px;cursor:pointer;font-size:15px;}
  .video-embed-fallback{position:relative;z-index:2;margin:0;padding:10px 16px;font-size:.8rem;color:rgba(241,237,228,.7);background:#0b0a0d;}

  .dc-slide-caption{background:#0b0a0d;padding:38px 24px 46px;text-align:center;}
  .dc-slide-caption p{font-family:'Fraunces',serif;font-weight:500;font-style:italic;font-size:1.35rem;max-width:560px;margin:0 auto 10px;line-height:1.4;}
  .dc-slide-caption span{display:block;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:rgba(241,237,228,.5);}
  .dc-slide-download{display:inline-flex;align-items:center;gap:8px;margin-top:14px;background:#c9a227;color:#171310;font-weight:600;font-size:.85rem;padding:9px 18px;border-radius:100px;text-decoration:none;white-space:nowrap;}
  .dc-slide-download:hover{background:#dab643;}

  /* ---- Depois da "story": final normal, com rolagem comum ---- */
  section{padding:64px 0;}
  .dc-section-title{font-family:'Fraunces',serif;font-weight:600;font-size:1.7rem;margin:0 0 8px;}
  .dc-section-sub{color:rgba(241,237,228,.55);font-size:.92rem;margin:0 0 34px;}

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

  .dc-footer{text-align:center;padding:16px 0 60px;color:rgba(241,237,228,.4);font-size:.8rem;}
  .dc-footer-brand{margin-bottom:6px;}
  .dc-footer-brand img{height:26px;width:auto;margin:0 auto;display:block;}
  .dc-social{display:flex;justify-content:center;gap:14px;margin-top:16px;flex-wrap:wrap;}
  .dc-social a{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(241,237,228,.25);padding:9px 18px;border-radius:100px;font-size:.82rem;text-decoration:none;color:rgba(241,237,228,.85);}
  .dc-social a:hover{border-color:#c9a227;color:#c9a227;}
  .empty-hint{color:rgba(241,237,228,.45);font-size:.9rem;}
  @media (max-width:640px){section{padding:44px 0;} .dc-cover{padding:64px 0 40px;} .dc-slide-caption{padding:30px 20px 38px;}}
`;

function pageScript(slug) {
  return `
  (function(){
    var els = document.querySelectorAll('.reveal');
    function revealAll(){ els.forEach(function(el){ el.classList.add('is-visible'); }); }
    try {
      if ('IntersectionObserver' in window) {
        // A página usa uma div interna com scroll próprio (".dc-story", tipo carrossel de
        // stories) em vez do scroll da própria página — passar ela como "root" explicitamente
        // evita que alguns navegadores (viu-se acontecer em desktop, mesmo com o mobile
        // funcionando normal) calculem errado o que já está visível quando quem rola não é a
        // página, e sim essa div de dentro.
        var storyRoot = document.querySelector('.dc-story');
        var io = new IntersectionObserver(function(entries){
          entries.forEach(function(e){ if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } });
        }, { root: storyRoot || null, threshold: .15 });
        els.forEach(function(el){ io.observe(el); });
        // Rede de segurança: se por qualquer motivo o observer não disparar pros elementos que
        // já estão visíveis assim que a página carrega (ex.: nome do cliente e frase de
        // boas-vindas na capa), força mostrar quem JÁ ESTÁ na tela em vez de deixar invisível pra
        // sempre — melhor perder a animação de entrada do que sumir com o conteúdo.
        // Importante: só revela quem já está dentro da área visível (checagem de posição real),
        // nunca todo mundo de uma vez — 17/09/2026 tentei uma versão que forçava TUDO visível
        // depois de 3s (pra resolver o download "sumido"), mas isso também apagava a propria
        // animação de entrada pra quem demora mais de 3s pra rolar até uma seção mais abaixo
        // ("n vi efeitos de nada" - o usuário via tudo já revelado antes de rolar até lá). A causa
        // raiz do download sumido já foi corrigida de verdade: download/comentários/rodapé agora
        // são filhos de ".dc-story" (fazem parte da mesma área rolável, ver
        // renderDeliveryCasePage), então o IntersectionObserver acima já os detecta certinho ao
        // rolar - essa rede de segurança aqui é só um reforço, repetida algumas vezes, sem nunca
        // revelar o que ainda está fora da tela.
        function revealVisibleNow(){
          var viewH = (storyRoot ? storyRoot.clientHeight : 0) || window.innerHeight || document.documentElement.clientHeight;
          els.forEach(function(el){
            if (el.classList.contains('is-visible')) return;
            var r = el.getBoundingClientRect();
            if (r.top < viewH && r.bottom > 0) el.classList.add('is-visible');
          });
        }
        [500, 1500, 4000, 8000].forEach(function(ms){ setTimeout(revealVisibleNow, ms); });
      } else {
        revealAll();
      }
    } catch (err) {
      revealAll();
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

    // Curtir foto/vídeo da entrega (pedido do usuário em 17/09/2026) — mesmo botão de coração já
    // usado no portfólio, guardando "já curtiu" no localStorage do próprio navegador do cliente
    // pra não deixar curtir a mesma foto/vídeo várias vezes clicando repetido.
    document.querySelectorAll('[data-dc-like-btn]').forEach(function(btn){
      var kind = btn.getAttribute('data-dc-like-kind');
      var id = btn.getAttribute('data-dc-like-id');
      if (!id) return;
      var storageKey = 'nj_liked_entrega_' + kind + '_' + id;
      var already = false;
      try { already = !!window.localStorage.getItem(storageKey); } catch (e) { already = false; }
      if (already) btn.classList.add('liked');

      btn.addEventListener('click', function(e){
        e.preventDefault();
        e.stopPropagation();
        var liked = false;
        try { liked = !!window.localStorage.getItem(storageKey); } catch (e) { liked = false; }
        if (liked || btn.disabled) return;
        btn.disabled = true;
        var endpoint = kind === 'video' ? 'entrega-curtir-video' : 'entrega-curtir-foto';
        fetch((window.NJFILMES_API_BASE || '') + '/api/' + endpoint + '/' + encodeURIComponent(id), { method: 'POST' })
          .then(function(r){ return r.json(); })
          .then(function(data){
            if (data && typeof data.likes === 'number') {
              var countEl = btn.querySelector('[data-dc-like-count]');
              if (countEl) countEl.textContent = data.likes;
              btn.classList.add('liked');
              try { window.localStorage.setItem(storageKey, '1'); } catch (e) { /* localStorage indisponível, sem problema */ }
            }
          })
          .catch(function(){ /* falha de rede: apenas destrava o botão pra tentar de novo */ })
          .finally(function(){ btn.disabled = false; });
      });
    });

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

// Cada foto/vídeo vira um "slide" de tela cheia, numerado em sequência — intercalando foto e
// vídeo na ordem em que foram adicionados no painel (ver renderMediaSlides abaixo). Só ganha o
// painel de legenda embaixo quando tem algo pra mostrar (legenda da foto, ou título/link de
// download do vídeo) — senão fica só a imagem/vídeo ocupando a tela toda, igual à referência que
// o usuário mandou (algumas fotos têm texto embaixo, outras não).
function renderMediaSlides(videos, photos) {
  // Junta fotos e vídeos numa timeline só, ordenada por sort_order (com o id como desempate) —
  // pedido do usuário em 17/09/2026 pra poder intercalar foto e vídeo na rolagem (não sempre
  // "todos os vídeos primeiro"). Como fotos e vídeos agora compartilham a mesma numeração de
  // sort_order (ver maxCombinedDeliverySortOrder em server/routes/admin.js), a ordem que aparece
  // aqui é simplesmente a ordem em que cada um foi adicionado no painel.
  const items = [
    ...videos.map((v) => ({ type: 'video', data: v, sortOrder: Number(v.sort_order) || 0, id: Number(v.id) || 0 })),
    ...photos.map((p) => ({ type: 'photo', data: p, sortOrder: Number(p.sort_order) || 0, id: Number(p.id) || 0 })),
  ].sort((a, b) => (a.sortOrder - b.sortOrder) || (a.id - b.id));
  return items
    .map((item, i) => {
      const number = String(i + 1).padStart(2, '0');
      if (item.type === 'video') {
        const v = item.data;
        const hasCaption = Boolean(v.title || v.download_url);
        return `<div class="dc-slide reveal">
          <div class="dc-slide-media">
            ${videoEmbedHtml(v, { className: 'dc-story-video' })}
            ${v.top_text ? `<div class="dc-slide-top-text reveal"><p>${escapeHtml(v.top_text)}</p></div>` : ''}
            <span class="dc-slide-number">${number}</span>
            <button type="button" class="dc-like-btn dc-like-btn--video" data-dc-like-btn data-dc-like-kind="video" data-dc-like-id="${v.id}">
              <span class="heart"></span> <span data-dc-like-count>${v.likes || 0}</span>
            </button>
          </div>
          ${hasCaption ? `<div class="dc-slide-caption">
            ${v.title ? `<p>${escapeHtml(v.title)}</p>` : ''}
            ${v.download_url ? `<a class="dc-slide-download" href="${escapeHtml(v.download_url)}" target="_blank" rel="noopener noreferrer">⭳ Baixar vídeo completo</a>` : ''}
          </div>` : ''}
        </div>`;
      }
      const p = item.data;
      // Não é só foto "deitada" (largura > altura) que fica ruim esticada num quadro alto e
      // estreito tipo story — foto quadrada (ou quase quadrada) também fica cortada demais nas
      // laterais com object-fit:cover. Por isso o corte pra usar "contain" + fundo desfocado é
      // width/height > 0.92 (pega quadradas e paisagens), não só width > height.
      const isLandscape =
        Number(p.width) > 0 && Number(p.height) > 0 && Number(p.width) / Number(p.height) > 0.92;
      return `<div class="dc-slide reveal">
        <div class="dc-slide-media${isLandscape ? ' is-landscape' : ''}">
          ${isLandscape ? `<div class="dc-slide-media-bg" style="background-image:url('${escapeHtml(p.filename)}')"></div>` : ''}
          <img src="${escapeHtml(p.filename)}" loading="lazy" alt="${escapeHtml(p.caption || '')}" data-lightbox-src="${escapeHtml(p.filename)}">
          ${p.top_text ? `<div class="dc-slide-top-text reveal"><p>${escapeHtml(p.top_text)}</p></div>` : ''}
          <span class="dc-slide-number">${number}</span>
          <button type="button" class="dc-like-btn" data-dc-like-btn data-dc-like-kind="photo" data-dc-like-id="${p.id}">
            <span class="heart"></span> <span data-dc-like-count>${p.likes || 0}</span>
          </button>
        </div>
        ${p.caption ? `<div class="dc-slide-caption"><p>${escapeHtml(p.caption)}</p></div>` : ''}
      </div>`;
    })
    .join('');
}

export function renderDeliveryCasePage(deliveryCase, settings = {}) {
  const c = deliveryCase;
  const photos = c.photos || [];
  const videos = c.videos || [];
  const hasStoryContent = videos.length > 0 || photos.length > 0;

  const coverHtml = `<div class="dc-cover">
        ${c.cover_photo ? `<div class="dc-cover-bg" style="background-image:url('${escapeHtml(c.cover_photo)}')"></div>` : '<div class="dc-cover-bg"></div>'}
        <span class="dc-brandmark reveal"><img src="/img/nj-logo.webp?v=${ASSET_VERSION}" alt="NJFILMES"></span>
        <div class="container dc-cover-inner">
          <span class="dc-eyebrow reveal">${c.cover_label ? escapeHtml(c.cover_label) : `NJ<span class="accent">FILMES</span> · Entrega`}</span>
          <h1 class="dc-title reveal">${escapeHtml(c.client_name)}</h1>
          ${c.welcome_message ? `<p class="dc-welcome reveal">${escapeHtml(c.welcome_message)}</p>` : ''}
        </div>
        ${hasStoryContent ? '<span class="dc-scroll-hint reveal">Role para ver</span>' : ''}
      </div>`;

  const downloadHtml = c.photos_download_url
    ? `<section><div class="container">
        <div class="download-section reveal">
          <h2 class="dc-section-title" style="margin:0;">Tem mais esperando por você</h2>
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

  // Rodapé com a marca e, se estiverem preenchidos nas Configurações do site, os mesmos botões
  // de WhatsApp/Instagram usados no resto do site — pedido do usuário depois de ver isso na
  // referência que mandou (o rodapé da entrega de outro fotógrafo tinha WhatsApp/Instagram dele).
  const waHref = waLink(settings.whatsapp_number, settings.whatsapp_message || `Olá! Vi a entrega "${c.client_name}" e queria falar com vocês.`);
  const socialLinksHtml = (waHref || settings.instagram_url)
    ? `<div class="dc-social reveal">
        ${waHref ? `<a href="${escapeHtml(waHref)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ''}
        ${settings.instagram_url ? `<a href="${escapeHtml(settings.instagram_url)}" target="_blank" rel="noopener noreferrer">Instagram</a>` : ''}
      </div>`
    : '';

  const footerHtml = `<div class="dc-footer">
      <div class="dc-footer-brand reveal"><img src="/img/nj-logo.webp?v=${ASSET_VERSION}" alt="NJFILMES"></div>
      <div class="reveal">Feito com carinho pela NJFILMES.</div>
      ${socialLinksHtml}
    </div>`;

  // Pedido do usuario (17/09/2026): "a rolagem do pc ta estranha ainda n ta na pagina toda
  // tendo outra rolagem do lado" - o motivo: quando tem foto/video (hasStoryContent), a capa +
  // fotos/videos ficavam dentro de ".dc-story" (uma div com scroll PRÓPRIO, pra dar o efeito de
  // "story" com encaixe), mas o download/comentarios/rodape vinham DEPOIS, fora dela, soltos no
  // fluxo normal da pagina - ou seja, a pagina toda (html/body) tambem podia rolar por conta
  // propria. Resultado: duas barras de rolagem, uma pra dentro da ".dc-story" e outra pra pagina
  // em si, um comportamento estranho (e foi tambem a causa raiz do problema anterior do botao de
  // download "sumido" - ele nao era filho de ".dc-story", entao a deteccao de "ta visivel na
  // tela" que usa ela como referencia nunca funcionava direito).
  // Correcao: quando tem foto/video, TUDO (capa, fotos/videos, download, comentarios, rodape) fica
  // dentro da mesma ".dc-story", que vira a UNICA coisa que rola - e a pagina (html/body) fica
  // travada (classe "dc-locked" mais abaixo no CSS) do tamanho exato da tela, sem rolagem propria.
  // Só uma barra de rolagem, do inicio ao fim. Quando NAO tem foto/video (so uma capa avulsa),
  // continua como antes - pagina normal, rolagem unica de qualquer forma, nada muda aqui.
  const bodyContent = hasStoryContent
    ? `<div class="dc-story">
        ${coverHtml}
        ${renderMediaSlides(videos, photos)}
        ${downloadHtml}
        ${commentsHtml}
        ${footerHtml}
      </div>`
    : `<header class="dc-cover-wrap">${coverHtml}</header>
      ${downloadHtml}
      ${commentsHtml}
      ${footerHtml}`;

  return `<!doctype html>
<html lang="pt-BR"${hasStoryContent ? ' class="dc-locked"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(c.client_name)} — NJFILMES</title>
${c.cover_photo ? `<meta property="og:image" content="${escapeHtml(c.cover_photo)}">` : ''}
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<style>${CASE_CSS}</style>
</head>
<body${hasStoryContent ? ' class="dc-locked"' : ''}>
  ${bodyContent}
  <div class="lightbox" id="dc-lightbox"><button class="lightbox-close" aria-label="Fechar">×</button><img src="" alt=""></div>
  <script>window.NJFILMES_API_BASE = ${JSON.stringify(PUBLIC_API_BASE)};</script>
  <script>${pageScript(c.slug)}</script>
</body>
</html>`;
}
