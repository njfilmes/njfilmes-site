// JS do site público — sem framework, sem build step (roda direto no navegador).
(function () {
  'use strict';

  // Quando o site é publicado como HTML estático (separado do backend que guarda curtidas e
  // visualizações), essa variável vem preenchida pelo servidor com a URL completa do backend.
  // No modo normal (site + admin no mesmo serviço) ela vem vazia e os caminhos abaixo continuam
  // relativos ao próprio domínio, sem nenhuma mudança de comportamento.
  var API_BASE = window.NJFILMES_API_BASE || '';

  // Limpeza da intro cinematografica (barras + logo): a decisao de tocar ou nao ja foi tomada
  // no script sincrono do <head> (classe no-intro), aqui so cuidamos de tirar a intro da tela
  // (display:none) depois que a animacao termina, e destravar a rolagem da pagina nesse meio
  // tempo (senao dava pra rolar "por baixo" das barras enquanto elas ainda estao saindo).
  var cineIntro = document.querySelector('[data-cine-intro]');
  if (cineIntro && !document.documentElement.classList.contains('no-intro')) {
    document.body.classList.add('cine-lock');
    setTimeout(function () {
      document.body.classList.remove('cine-lock');
      cineIntro.style.display = 'none';
    }, 1650);
  }

  // Header muda de estilo ao rolar, e se esconde ao descer / reaparece ao subir
  var header = document.querySelector('[data-header]');
  if (header) {
    var lastY = window.scrollY;
    var onScroll = function () {
      var y = window.scrollY;
      if (y > 40) header.classList.add('scrolled');
      else header.classList.remove('scrolled');

      if (y > lastY && y > 160) header.classList.add('hide-on-scroll');
      else header.classList.remove('hide-on-scroll');
      lastY = y;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // Cursor personalizado "VER PROJETO" nos cards de portfólio
  var workCards = document.querySelectorAll('[data-work-card]');
  if (workCards.length && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    var cursor = document.createElement('div');
    cursor.className = 'work-cursor';
    cursor.innerHTML = '<span>Ver projeto</span>';
    document.body.appendChild(cursor);

    var cx = 0, cy = 0, tx = 0, ty = 0;
    var active = false;
    var loop = function () {
      cx += (tx - cx) * 0.18;
      cy += (ty - cy) * 0.18;
      cursor.style.transform = 'translate(' + cx + 'px, ' + cy + 'px) translate(-50%, -50%) scale(' + (active ? 1 : 0.4) + ')';
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    window.addEventListener('mousemove', function (e) { tx = e.clientX; ty = e.clientY; }, { passive: true });

    workCards.forEach(function (card) {
      card.addEventListener('mouseenter', function () { active = true; cursor.classList.add('is-active'); });
      card.addEventListener('mouseleave', function () { active = false; cursor.classList.remove('is-active'); });
    });
  }

  // Menu mobile (tem 3 jeitos de fechar - o X dentro do proprio menu, tocar no fundo
  // escurecido, ou arrastar o menu pro lado/pra cima)
  var nav = document.querySelector('[data-nav]');
  var toggle = document.querySelector('[data-nav-toggle]');
  var navClose = document.querySelector('[data-nav-close]');
  var navBackdrop = document.querySelector('[data-nav-backdrop]');
  if (nav && toggle) {
    var openNav = function () {
      nav.classList.add('open');
      if (navBackdrop) navBackdrop.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
    };
    var closeNav = function () {
      nav.classList.remove('open');
      if (navBackdrop) navBackdrop.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    };
    toggle.addEventListener('click', function () {
      if (nav.classList.contains('open')) closeNav();
      else openNav();
    });
    if (navClose) navClose.addEventListener('click', closeNav);
    if (navBackdrop) navBackdrop.addEventListener('click', closeNav);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) closeNav();
    });

    // Arrastar o menu pro lado ou pra cima fecha, igual a maioria dos apps
    var touchStartX = 0;
    var touchStartY = 0;
    nav.addEventListener('touchstart', function (e) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    nav.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - touchStartX;
      var dy = e.changedTouches[0].clientY - touchStartY;
      if (dx > 50 || dy < -50) closeNav();
    }, { passive: true });

    // Em telas pequenas, o submenu de categorias abre/fecha ao tocar no link "Portfólio"
    document.querySelectorAll('.has-sub > a').forEach(function (link) {
      link.addEventListener('click', function (e) {
        if (window.innerWidth <= 720) {
          e.preventDefault();
          link.closest('.has-sub').classList.toggle('open');
        }
      });
    });
  }

  // Animações de entrada ao rolar a página (fade + slide sutil). Rede de segurança por
  // tempo: mesmo que o IntersectionObserver falhe, o conteúdo é revelado depois de 2s.
  var revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length) {
    try {
      if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(
          function (entries) {
            entries.forEach(function (entry) {
              if (entry.isIntersecting) {
                entry.target.classList.add('in-view');
                io.unobserve(entry.target);
              }
            });
          },
          { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
        );
        revealEls.forEach(function (el) { io.observe(el); });
      } else {
        revealEls.forEach(function (el) { el.classList.add('in-view'); });
      }
    } catch (err) {
      revealEls.forEach(function (el) { el.classList.add('in-view'); });
    }
    setTimeout(function () {
      revealEls.forEach(function (el) { el.classList.add('in-view'); });
    }, 2000);
  }

  // Parallax leve no vídeo/imagem do hero (discreto, sem prejudicar performance)
  var heroMedia = document.querySelector('.hero-media');
  if (heroMedia) {
    window.addEventListener(
      'scroll',
      function () {
        var y = window.scrollY;
        if (y < window.innerHeight) {
          heroMedia.style.transform = 'translateY(' + (y * 0.25) + 'px)';
        }
      },
      { passive: true }
    );
  }

  // Filtro de categorias no portfólio (client-side, sem recarregar a página)
  var filterBar = document.querySelector('[data-filter-bar]');
  if (filterBar) {
    var cards = document.querySelectorAll('[data-work-card]');
    filterBar.addEventListener('click', function (e) {
      var pill = e.target.closest('.filter-pill');
      if (!pill) return;
      filterBar.querySelectorAll('.filter-pill').forEach(function (p) { p.classList.remove('active'); });
      pill.classList.add('active');
      var cat = pill.dataset.cat;
      cards.forEach(function (card) {
        var show = cat === 'all' || card.dataset.category === cat;
        card.style.display = show ? '' : 'none';
      });
      var url = new URL(window.location);
      if (cat === 'all') url.searchParams.delete('categoria');
      else url.searchParams.set('categoria', cat);
      window.history.replaceState({}, '', url);
    });
  }

  // Lightbox de galeria
  var lightbox = document.querySelector('[data-lightbox]');
  if (lightbox) {
    var imgEl = lightbox.querySelector('img');
    var counterEl = lightbox.querySelector('[data-lightbox-counter]');
    var triggers = Array.from(document.querySelectorAll('[data-lightbox-trigger]'));
    var current = 0;

    var show = function () {
      var full = triggers[current].dataset.full || triggers[current].querySelector('img').src;
      imgEl.src = full;
      imgEl.alt = triggers[current].dataset.caption || '';
      if (counterEl) counterEl.textContent = (current + 1) + ' / ' + triggers.length;
    };
    var open = function (index) {
      current = index;
      show();
      lightbox.classList.add('open');
      document.body.style.overflow = 'hidden';
    };
    var close = function () {
      lightbox.classList.remove('open');
      document.body.style.overflow = '';
    };
    var next = function () { current = (current + 1) % triggers.length; show(); };
    var prev = function () { current = (current - 1 + triggers.length) % triggers.length; show(); };

    triggers.forEach(function (trigger, i) {
      trigger.addEventListener('click', function () { open(i); });
    });
    var closeBtn = lightbox.querySelector('[data-lightbox-close]');
    if (closeBtn) closeBtn.addEventListener('click', close);
    var nextBtn = lightbox.querySelector('[data-lightbox-next]');
    if (nextBtn) nextBtn.addEventListener('click', next);
    var prevBtn = lightbox.querySelector('[data-lightbox-prev]');
    if (prevBtn) prevBtn.addEventListener('click', prev);
    lightbox.addEventListener('click', function (e) { if (e.target === lightbox) close(); });
    document.addEventListener('keydown', function (e) {
      if (!lightbox.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    });

    // Deslizar o dedo pros lados na foto ampliada troca pra próxima/anterior, igual redes
    // sociais — pedido do usuário em 03/09/2026, além dos botões de seta que já existiam.
    var touchStartX = null;
    var touchStartY = null;
    lightbox.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    lightbox.addEventListener('touchend', function (e) {
      if (touchStartX === null) return;
      var touch = e.changedTouches[0];
      var dx = touch.clientX - touchStartX;
      var dy = touch.clientY - touchStartY;
      touchStartX = null;
      touchStartY = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) next(); else prev();
      }
    }, { passive: true });
  }

  // Faixa "Bastidores" (página Sobre): rola sozinha, mas a pessoa pode segurar e arrastar/
  // deslizar pros lados a qualquer momento pra navegar no próprio ritmo — a rolagem automática
  // para assim que ela mexe pela primeira vez, pra não "brigar" com o gesto dela. Clicar numa
  // foto sem arrastar continua abrindo ela ampliada (o lightbox acima já cuida disso sozinho,
  // pelo atributo data-lightbox-trigger). Pedido do usuário em 03/09/2026.
  var dragTrack = document.querySelector('[data-drag-scroll-track]');
  if (dragTrack) {
    var dragActive = false;
    var dragMoved = false;
    var dragStartX = 0;
    var dragBaseX = 0;
    var dragSetWidth = 0;

    var readTranslateX = function () {
      var t = window.getComputedStyle(dragTrack).transform;
      if (!t || t === 'none') return 0;
      var m3d = t.match(/matrix3d\(([^)]+)\)/);
      if (m3d) return parseFloat(m3d[1].split(',')[12]) || 0;
      var m2d = t.match(/matrix\(([^)]+)\)/);
      if (m2d) return parseFloat(m2d[1].split(',')[4]) || 0;
      return 0;
    };

    dragTrack.addEventListener('pointerdown', function (e) {
      if (!dragTrack.classList.contains('dragging')) {
        dragBaseX = readTranslateX();
        dragTrack.style.animation = 'none';
        dragTrack.style.transform = 'translateX(' + dragBaseX + 'px)';
        dragTrack.classList.add('dragging');
        dragSetWidth = dragTrack.scrollWidth / 2;
      } else {
        dragBaseX = readTranslateX();
      }
      dragActive = true;
      dragMoved = false;
      dragStartX = e.clientX;
    });
    window.addEventListener('pointermove', function (e) {
      if (!dragActive) return;
      var delta = e.clientX - dragStartX;
      if (Math.abs(delta) > 4) dragMoved = true;
      var nextX = dragBaseX + delta;
      if (dragSetWidth > 0) {
        while (nextX <= -dragSetWidth) nextX += dragSetWidth;
        while (nextX > 0) nextX -= dragSetWidth;
      }
      dragTrack.style.transform = 'translateX(' + nextX + 'px)';
    });
    var endDrag = function () { dragActive = false; };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    // Só suprime o clique (que abriria o lightbox) quando teve arrasto de verdade.
    dragTrack.addEventListener('click', function (e) {
      if (dragMoved) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  }

  // Botão de tela cheia nos vídeos embutidos (Mega/YouTube/Vimeo/Drive). Fica fora da área do
  // player pra não brigar com o play/pause dele; clicar chama fullscreen no próprio iframe.
  document.querySelectorAll('[data-video-fullscreen]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var iframe = btn.parentElement && btn.parentElement.querySelector('iframe');
      if (!iframe) return;
      var request = iframe.requestFullscreen || iframe.webkitRequestFullscreen || iframe.mozRequestFullScreen || iframe.msRequestFullscreen;
      if (request) request.call(iframe).catch(function () { /* alguns navegadores recusam sem gesto direto; ignora */ });
    });
  });

  // Leve efeito de inclinação 3D em cards ao passar o mouse (só quem tem mouse de verdade)
  var tiltEls = document.querySelectorAll('[data-work-card], .service-card, .person-card, .contact-card, .about-split img');
  if (tiltEls.length && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    tiltEls.forEach(function (el) {
      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = 'perspective(900px) rotateX(' + (py * -7).toFixed(2) + 'deg) rotateY(' + (px * 7).toFixed(2) + 'deg) scale3d(1.02, 1.02, 1.02)';
        // Reflexo/brilho que acompanha o mouse (CSS le essas variaveis no ::after do card -
        // ver style.css). Nao se aplica em .about-split img (e uma <img> sozinha, sem ::after).
        el.style.setProperty('--mx', ((px + 0.5) * 100).toFixed(1) + '%');
        el.style.setProperty('--my', ((py + 0.5) * 100).toFixed(1) + '%');
      });
      el.addEventListener('mouseleave', function () { el.style.transform = ''; });
    });
  }

  // Luz ambiente dourada que segue o cursor pela pagina inteira (so quem tem mouse de verdade,
  // e nunca pra quem pediu menos movimento) - pedido em 02/09/2026 pra dar mais profundidade.
  if (
    window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    var glow = document.createElement('div');
    glow.className = 'cursor-glow';
    glow.setAttribute('aria-hidden', 'true');
    document.body.appendChild(glow);
    var glowX = window.innerWidth / 2, glowY = window.innerHeight / 2;
    var glowTX = glowX, glowTY = glowY;
    window.addEventListener('mousemove', function (e) { glowTX = e.clientX; glowTY = e.clientY; }, { passive: true });
    var glowLoop = function () {
      glowX += (glowTX - glowX) * 0.09;
      glowY += (glowTY - glowY) * 0.09;
      glow.style.transform = 'translate(' + glowX + 'px, ' + glowY + 'px) translate(-50%, -50%)';
      requestAnimationFrame(glowLoop);
    };
    requestAnimationFrame(glowLoop);
  }

  // Barra de progresso de rolagem
  var scrollBar = document.createElement('div');
  scrollBar.className = 'scroll-progress';
  document.body.appendChild(scrollBar);
  var updateScrollBar = function () {
    var doc = document.documentElement;
    var scrollable = doc.scrollHeight - doc.clientHeight;
    var pct = scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0;
    scrollBar.style.width = pct + '%';
  };
  updateScrollBar();
  window.addEventListener('scroll', updateScrollBar, { passive: true });
  window.addEventListener('resize', updateScrollBar);

  // Contador animado nas estatísticas da página Sobre (números que sobem do zero)
  var statEls = document.querySelectorAll('.stat b');
  if (statEls.length && 'IntersectionObserver' in window) {
    var animateCount = function (el) {
      var raw = el.textContent.trim();
      var match = raw.match(/^(\d+)(.*)$/);
      if (!match) return;
      var target = parseInt(match[1], 10);
      var suffix = match[2] || '';
      if (!target || target > 9999) return;
      var duration = 1100;
      var start = performance.now();
      var step = function (now) {
        var progress = Math.min((now - start) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(target * eased) + suffix;
        if (progress < 1) requestAnimationFrame(step);
        else el.textContent = target + suffix;
      };
      requestAnimationFrame(step);
    };
    var statIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateCount(entry.target);
          statIo.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });
    statEls.forEach(function (el) { statIo.observe(el); });
  }

  // Efeito magnético sutil nos botões
  var magneticBtns = document.querySelectorAll('.btn');
  if (magneticBtns.length && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    magneticBtns.forEach(function (btn) {
      btn.addEventListener('mousemove', function (e) {
        var r = btn.getBoundingClientRect();
        var mx = (e.clientX - r.left - r.width / 2) * 0.25;
        var my = (e.clientY - r.top - r.height / 2) * 0.35;
        btn.style.transform = 'translate(' + mx + 'px, ' + (my - 2) + 'px)';
      });
      btn.addEventListener('mouseleave', function () { btn.style.transform = ''; });
    });
  }

  // Fotos da página Sobre passando sozinhas (crossfade)
  var aboutSlides = document.querySelectorAll('.about-photo-slide');
  if (aboutSlides.length > 1) {
    var aboutIndex = 0;
    setInterval(function () {
      aboutSlides[aboutIndex].classList.remove('is-active');
      aboutIndex = (aboutIndex + 1) % aboutSlides.length;
      aboutSlides[aboutIndex].classList.add('is-active');
    }, 3500);
  }

  // Botão "voltar ao topo"
  var backToTop = document.querySelector('[data-back-to-top]');
  if (backToTop) {
    var toggleBackToTop = function () {
      if (window.scrollY > window.innerHeight * 0.6) backToTop.classList.add('is-visible');
      else backToTop.classList.remove('is-visible');
    };
    toggleBackToTop();
    window.addEventListener('scroll', toggleBackToTop, { passive: true });
    backToTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Contador de visualizações: como a página do projeto pode ser servida como HTML estático
  // (sem código rodando a cada acesso), a visualização é somada aqui, pelo navegador, uma vez
  // por carregamento de página — via fetch pra /api/visualizar/:slug.
  try {
    var viewsBlock = document.querySelector('[data-views-block]');
    if (viewsBlock) {
      var viewsSlug = viewsBlock.getAttribute('data-project');
      if (viewsSlug) {
        fetch(API_BASE + '/api/visualizar/' + encodeURIComponent(viewsSlug), { method: 'POST' })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data && typeof data.views === 'number') {
              var viewCountEl = viewsBlock.querySelector('[data-view-count]');
              if (viewCountEl) viewCountEl.textContent = data.views;
              var viewWordEl = viewsBlock.querySelector('[data-view-word]');
              if (viewWordEl) viewWordEl.textContent = data.views === 1 ? 'visualização' : 'visualizações';
            }
          })
          .catch(function () { /* falha de rede: mantém o número já exibido na página */ });
      }
    }
  } catch (err) { /* não deixa um erro aqui travar o resto do script */ }

  // Botão de curtir do projeto.
  try {
    var likeBtns = Array.from(document.querySelectorAll('[data-like-btn]'));
    likeBtns.forEach(function (btn) {
      var slug = btn.getAttribute('data-project');
      if (!slug) return;
      var storageKey = 'nj_liked_' + slug;
      var already = false;
      try { already = !!window.localStorage.getItem(storageKey); } catch (e) { already = false; }
      if (already) btn.classList.add('liked');

      btn.addEventListener('click', function () {
        var liked = false;
        try { liked = !!window.localStorage.getItem(storageKey); } catch (e) { liked = false; }
        if (liked || btn.disabled) return;
        btn.disabled = true;
        fetch(API_BASE + '/api/curtir/' + encodeURIComponent(slug), { method: 'POST' })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data && typeof data.likes === 'number') {
              var countEl = btn.querySelector('[data-like-count]');
              if (countEl) countEl.textContent = data.likes;
              btn.classList.add('liked');
              try { window.localStorage.setItem(storageKey, '1'); } catch (e) { /* localStorage indisponível, sem problema */ }
            }
          })
          .catch(function () { /* falha de rede: apenas destrava o botão pra tentar de novo */ })
          .finally(function () { btn.disabled = false; });
      });
    });
  } catch (err) { /* não deixa um erro aqui travar o resto do script */ }

  // Comentários dos visitantes na página do projeto: como a página pode ser HTML estático, a
  // lista é buscada aqui via fetch (não vem pronta no HTML) e o formulário envia via fetch
  // também. O conteúdo digitado por visitantes é sempre inserido via textContent (nunca
  // innerHTML) para não correr risco nenhum de injeção de HTML/script.
  try {
    var commentsSection = document.querySelector('[data-comments]');
    if (commentsSection) {
      var commentsSlug = commentsSection.getAttribute('data-project');
      var commentsListEl = commentsSection.querySelector('[data-comments-list]');
      var commentForm = commentsSection.querySelector('[data-comment-form]');
      var commentStatusEl = commentsSection.querySelector('[data-comment-status]');

      var formatCommentDate = function (iso) {
        try {
          var d = new Date(iso);
          if (isNaN(d.getTime())) return '';
          return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch (e) { return ''; }
      };

      // Contador de comentários que aparece junto com curtir/visualizações, no estilo rede
      // social (Instagram/YouTube) — pedido do usuário em 03/09/2026. Fica fora da seção de
      // comentários, então precisa ser atualizado à parte sempre que a lista é buscada/muda.
      var updateCommentsCount = function (count) {
        var countEls = document.querySelectorAll('[data-comments-count]');
        for (var i = 0; i < countEls.length; i++) countEls[i].textContent = count;
      };

      var renderComments = function (comments) {
        updateCommentsCount(comments ? comments.length : 0);
        if (!commentsListEl) return;
        commentsListEl.textContent = '';
        if (!comments || !comments.length) {
          var empty = document.createElement('p');
          empty.className = 'comments-empty';
          empty.textContent = 'Nenhum comentário ainda. Seja o primeiro a comentar!';
          commentsListEl.appendChild(empty);
          return;
        }
        comments.forEach(function (c) {
          var item = document.createElement('div');
          item.className = 'comment-item';

          var head = document.createElement('div');
          head.className = 'comment-head';
          var author = document.createElement('span');
          author.className = 'comment-author';
          author.textContent = c.author_name || '';
          var date = document.createElement('span');
          date.className = 'comment-date';
          date.textContent = formatCommentDate(c.created_at);
          head.appendChild(author);
          head.appendChild(date);
          item.appendChild(head);

          var body = document.createElement('p');
          body.className = 'comment-content';
          body.textContent = c.content || '';
          item.appendChild(body);

          if (c.admin_reply) {
            var reply = document.createElement('div');
            reply.className = 'comment-reply';
            var label = document.createElement('span');
            label.className = 'comment-reply-label';
            label.textContent = 'Resposta da NJFILMES';
            var replyBody = document.createElement('p');
            replyBody.style.margin = '0';
            replyBody.textContent = c.admin_reply;
            reply.appendChild(label);
            reply.appendChild(replyBody);
            item.appendChild(reply);
          }

          commentsListEl.appendChild(item);
        });
      };

      var loadComments = function () {
        if (!commentsSlug) return;
        fetch(API_BASE + '/api/comentarios/' + encodeURIComponent(commentsSlug))
          .then(function (r) { return r.json(); })
          .then(function (data) { renderComments(data && data.comments); })
          .catch(function () {
            updateCommentsCount(0);
            if (commentsListEl) {
              commentsListEl.textContent = '';
              var err = document.createElement('p');
              err.className = 'comments-empty';
              err.textContent = 'Não foi possível carregar os comentários agora.';
              commentsListEl.appendChild(err);
            }
          });
      };
      loadComments();

      if (commentForm) {
        commentForm.addEventListener('submit', function (ev) {
          ev.preventDefault();
          if (!commentsSlug) return;
          var submitBtn = commentForm.querySelector('button[type="submit"]');
          var authorName = commentForm.querySelector('[name="author_name"]');
          var content = commentForm.querySelector('[name="content"]');
          var honeypot = commentForm.querySelector('[name="empresa"]');

          if (commentStatusEl) { commentStatusEl.textContent = ''; commentStatusEl.className = 'comment-form-status'; }
          if (submitBtn) submitBtn.disabled = true;

          fetch(API_BASE + '/api/comentarios/' + encodeURIComponent(commentsSlug), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              author_name: authorName ? authorName.value : '',
              content: content ? content.value : '',
              empresa: honeypot ? honeypot.value : '',
            }),
          })
            .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
            .then(function (result) {
              if (result.ok && result.data && result.data.ok) {
                commentForm.reset();
                if (commentStatusEl) {
                  commentStatusEl.textContent = 'Comentário enviado!';
                  commentStatusEl.className = 'comment-form-status is-success';
                }
                loadComments();
              } else {
                if (commentStatusEl) {
                  commentStatusEl.textContent = (result.data && result.data.error) || 'Não foi possível enviar seu comentário.';
                  commentStatusEl.className = 'comment-form-status is-error';
                }
              }
            })
            .catch(function () {
              if (commentStatusEl) {
                commentStatusEl.textContent = 'Falha de conexão. Tente novamente.';
                commentStatusEl.className = 'comment-form-status is-error';
              }
            })
            .finally(function () {
              if (submitBtn) submitBtn.disabled = false;
            });
        });
      }
    }
  } catch (err) { /* não deixa um erro aqui travar o resto do script */ }
})();
