// JS do site público — sem framework, sem build step (roda direto no navegador).
(function () {
  'use strict';

  // Header muda de estilo ao rolar, e se esconde ao descer / reaparece ao subir
  const header = document.querySelector('[data-header]');
  if (header) {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
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
  const workCards = document.querySelectorAll('[data-work-card]');
  if (workCards.length && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    const cursor = document.createElement('div');
    cursor.className = 'work-cursor';
    cursor.innerHTML = '<span>Ver projeto</span>';
    document.body.appendChild(cursor);

    let cx = 0, cy = 0, tx = 0, ty = 0;
    let active = false;
    const loop = () => {
      cx += (tx - cx) * 0.18;
      cy += (ty - cy) * 0.18;
      cursor.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%) scale(${active ? 1 : 0.4})`;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    window.addEventListener('mousemove', (e) => { tx = e.clientX; ty = e.clientY; }, { passive: true });

    workCards.forEach((card) => {
      card.addEventListener('mouseenter', () => { active = true; cursor.classList.add('is-active'); });
      card.addEventListener('mouseleave', () => { active = false; cursor.classList.remove('is-active'); });
    });
  }

  // Menu mobile
  const nav = document.querySelector('[data-nav]');
  const toggle = document.querySelector('[data-nav-toggle]');
  if (nav && toggle) {
    toggle.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });
    // Em telas pequenas, o submenu de categorias abre/fecha ao tocar no link "Portfólio"
    document.querySelectorAll('.has-sub > a').forEach((link) => {
      link.addEventListener('click', (e) => {
        if (window.innerWidth <= 720) {
          e.preventDefault();
          link.closest('.has-sub').classList.toggle('open');
        }
      });
    });
  }

  // Animações de entrada ao rolar a página (fade + slide sutil)
  const revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('in-view'));
  }

  // Parallax leve no vídeo/imagem do hero (discreto, sem prejudicar performance)
  const heroMedia = document.querySelector('.hero-media');
  if (heroMedia) {
    window.addEventListener(
      'scroll',
      () => {
        const y = window.scrollY;
        if (y < window.innerHeight) {
          heroMedia.style.transform = `translateY(${y * 0.25}px)`;
        }
      },
      { passive: true }
    );
  }

  // Filtro de categorias no portfólio (client-side, sem recarregar a página)
  const filterBar = document.querySelector('[data-filter-bar]');
  if (filterBar) {
    const cards = document.querySelectorAll('[data-work-card]');
    filterBar.addEventListener('click', (e) => {
      const pill = e.target.closest('.filter-pill');
      if (!pill) return;
      filterBar.querySelectorAll('.filter-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      const cat = pill.dataset.cat;
      cards.forEach((card) => {
        const show = cat === 'all' || card.dataset.category === cat;
        card.style.display = show ? '' : 'none';
      });
      const url = new URL(window.location);
      if (cat === 'all') url.searchParams.delete('categoria');
      else url.searchParams.set('categoria', cat);
      window.history.replaceState({}, '', url);
    });
  }

  // Lightbox de galeria
  const lightbox = document.querySelector('[data-lightbox]');
  if (lightbox) {
    const imgEl = lightbox.querySelector('img');
    const counterEl = lightbox.querySelector('[data-lightbox-counter]');
    const triggers = Array.from(document.querySelectorAll('[data-lightbox-trigger]'));
    let current = 0;

    const open = (index) => {
      current = index;
      show();
      lightbox.classList.add('open');
      document.body.style.overflow = 'hidden';
    };
    const close = () => {
      lightbox.classList.remove('open');
      document.body.style.overflow = '';
    };
    const show = () => {
      const full = triggers[current].dataset.full || triggers[current].querySelector('img').src;
      imgEl.src = full;
      imgEl.alt = triggers[current].dataset.caption || '';
      if (counterEl) counterEl.textContent = `${current + 1} / ${triggers.length}`;
    };
    const next = () => { current = (current + 1) % triggers.length; show(); };
    const prev = () => { current = (current - 1 + triggers.length) % triggers.length; show(); };

    triggers.forEach((trigger, i) => {
      trigger.addEventListener('click', () => open(i));
    });
    lightbox.querySelector('[data-lightbox-close]')?.addEventListener('click', close);
    lightbox.querySelector('[data-lightbox-next]')?.addEventListener('click', next);
    lightbox.querySelector('[data-lightbox-prev]')?.addEventListener('click', prev);
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) close(); });
    document.addEventListener('keydown', (e) => {
      if (!lightbox.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    });
  }
const tiltEls = document.querySelectorAll('[data-work-card], .service-card, .person-card, .contact-card, .about-split img'); if (tiltEls.length && window.matchMedia('(hover: hover) and (pointer: fine)').matches) { tiltEls.forEach((el) => { el.addEventListener('mousemove', (e) => { const r = el.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width - 0.5; const py = (e.clientY - r.top) / r.height - 0.5; el.style.transform = `perspective(900px) rotateX(${(py * -7).toFixed(2)}deg) rotateY(${(px * 7).toFixed(2)}deg) scale3d(1.02, 1.02, 1.02)`; }); el.addEventListener('mouseleave', () => { el.style.transform = ''; }); }); } })();
