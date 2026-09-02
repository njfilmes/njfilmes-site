// JS do site público — sem framework, sem build step (roda direto no navegador).
(function () {
  'use strict';

  // Quando o site é publicado como HTML estático (separado do backend que guarda curtidas e
  // visualizações), essa variável vem preenchida pelo servidor com a URL completa do backend.
  // No modo normal (site + admin no mesmo serviço) ela vem vazia e os caminhos abaixo continuam
  // relativos ao próprio domínio, sem nenhuma mudança de comportamento.
  var API_BASE = window.NJFILMES_API_BASE || '';

  // Animações de entrada ao rolar a página (fade + slide sutil).
  // Isso roda ANTES de tudo, e tem uma rede de segurança por tempo: mesmo que
  // algum outro trecho de código abaixo tenha erro, ou o navegador demore para
  // disparar o IntersectionObserver, o conteúdo é revelado de qualquer forma
  // depois de 2s. Isso evita que a página fique com seções "pretas"/invisíveis.
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

  // Header muda de estilo ao rolar, e se esconde ao descer / reaparece ao subir
  try {
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
  } catch (err) { /* não deixa um erro aqui travar o resto do script */ }

  // Cursor personalizado "VER PROJETO" nos cards de portfólio
  try {
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
  } catch (err) { /* não deixa um erro aqui travar o resto do script */ }

  // Menu mobile
  try {
    var nav = document.querySelector('[data-nav]');
    var toggle = document.querySelector('[data-nav-toggle]');
    if (nav && toggle) {
      toggle.addEventListener('click', function () {
        var isOpen = nav.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(isOpen));
      });
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
  } catch (err) { /* não deixa um erro aqui travar o resto do script */ }

  // Parallax leve no vídeo/imagem do hero (discreto, sem prejudicar performance)
  try {
    var heroMedia = document.querySelector('.hero-media');
    if (heroMedia) {
      window.addEventListener(
        'scroll',
        function () {
          var y = window.scrollY;
          if (y < window.innerHeight) {
            heroMedia.style.transform = 'translateY(' + Math.min(y * 0.18, 90) + 'px)';
          }
        },
        { passive: true }
      );
    }
  } catch (err) { /* não deixa um erro aqui travar o resto do script */ }

  // Filtro de categorias no portfólio (client-side, sem recarregar a página)
  try {
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
  } catch (err) { /* não deixa um erro aqui travar o resto do script */ }

  // Lightbox de galeria
  try {
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
    }
  } catch (err) { /* não deixa um erro aqui travar o resto do script */ }

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
              if (viewWordEl) viewWordEl.textContent = data.views === 1 ? 'ção' : 'ções';
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
})();
