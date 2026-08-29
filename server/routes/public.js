import { layout } from '../render.js';
import { escapeHtml, nl2br, videoEmbedHtml, formatDatePtBr, truncate } from '../util.js';
import {
  getSettings,
  getBio,
  listCategories,
  getCategoryBySlug,
  listServices,
  listLinks,
  listProjects,
  getProjectBySlug,
  listBrands,
  listPeople,
  listTestimonials,
} from '../queries.js';

function coverUrl(project) {
  return project.cover_photo || (project.photos && project.photos[0] && project.photos[0].filename) || '/img/placeholder.svg';
}

function workCard(project, opts = {}) {
  const cat = project.category_name || '';
  const hasVideo = project.videos && project.videos.length > 0;
  return `<a href="/portfolio/${escapeHtml(project.slug)}" class="work-card reveal ${opts.tall ? 'tall' : ''}" data-work-card data-category="${escapeHtml(project.category_slug || '')}">
    <img src="${escapeHtml(coverUrl(project))}" alt="${escapeHtml(project.title)}" loading="lazy">
    ${hasVideo ? `<span class="play"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>` : ''}
    <span class="overlay">
      ${cat ? `<span class="cat">${escapeHtml(cat)}</span>` : ''}
      <h3>${escapeHtml(project.title)}</h3>
    </span>
  </a>`;
}

// Renderiza a frase de destaque do hero destacando a última palavra em dourado
// (a cor de marca --accent), pra dar um toque visual sem precisar mexer em HTML
// toda vez que o texto for editado pelo painel administrativo.
function heroHeadlineHtml(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace === -1) return `<span class="text-accent">${escapeHtml(trimmed)}</span>`;
  const rest = trimmed.slice(0, lastSpace);
  const last = trimmed.slice(lastSpace + 1);
  return `${escapeHtml(rest)} <span class="text-accent">${escapeHtml(last)}</span>`;
}

// Versao do arquivo do hero, usada como "carimbo" (?v=) na URL da foto/poster
// pra forcar navegadores e CDNs a buscarem a versao mais nova sempre que a
// foto for trocada pelo painel/commit, sem precisar de Ctrl+F5 no cliente.
const HERO_IMG_VERSION = '20260829b';

export function homePage(req, res) {
  const settings = getSettings();
  const categories = listCategories();
  const featured = listProjects({ onlyPublished: true, featuredOnly: true, limit: 1 })[0];
  const recent = listProjects({ onlyPublished: true, limit: 7 }).filter((p) => !featured || p.id !== featured.id).slice(0, 6);
  const services = listServices({ onlyPublished: true }).slice(0, 6);
  const brands = listBrands();
  const people = listPeople();
  const testimonials = listTestimonials();

  const heroPosterUrl = `/img/hero-poster.jpg?v=${HERO_IMG_VERSION}`;
  const heroVideo = settings.hero_video_url
    ? `<video autoplay muted loop playsinline poster="${heroPosterUrl}" src="${escapeHtml(settings.hero_video_url)}"></video>`
    : `<div class="hero-photo-split"><img class="hero-photo-a" src="${heroPosterUrl}" alt="NJFILMES"><img class="hero-photo-b" src="${heroPosterUrl}" alt="NJFILMES"></div>`;

  // Faixa que rola na horizontal: marcas (logos) e artistas/pessoas (foto + nome) juntos,
  // sempre coloridos — sem preto e branco.
  const marqueeChips = [
    ...brands.map(
      (b) => {
        // Excecao: logos que ja vem com moldura/fundo proprio (ex: Rockhair Barbearia)
        // nao ganham o circulo branco padrao e aparecem um pouco maiores.
        const isPlainLogo = b.name === 'Rockhair Barbearia';
        return `<a class="brand-chip" href="${b.url ? escapeHtml(b.url) : '#'}" ${b.url ? 'target="_blank" rel="noopener noreferrer"' : 'tabindex="-1" style="pointer-events:none;"'}><div class="brand-chip-logo${isPlainLogo ? ' no-frame' : ''}"><img src="${escapeHtml(b.logo)}" alt="${escapeHtml(b.name)}" loading="lazy"></div><span>${escapeHtml(b.name)}</span></a>`;
      }
    ),
    ...people.map(
      (p) =>
        `<div class="person-chip"><div class="person-chip-photo"><img src="${escapeHtml(p.photo)}" alt="${escapeHtml(p.name)}" loading="lazy"></div><span>${escapeHtml(p.name)}</span></div>`
    ),
  ];

  // Faixa de depoimentos em vídeo (feedback de clientes): rolagem manual, um vídeo
  // "passando" atrás do outro conforme a pessoa arrasta/rola pro lado.
  const testimonialCards = testimonials.map(
    (t) => `<div class="testimonial-card reveal">
      ${videoEmbedHtml({ provider: t.provider, video_id: t.video_id, url: t.video_url, title: t.client_name }, { className: 'testimonial-video video-embed' })}
      <div class="testimonial-info">
        <b>${escapeHtml(t.client_name)}</b>
        ${t.role ? `<span>${escapeHtml(t.role)}</span>` : ''}
      </div>
    </div>`
  );

  const content = `
    <section class="hero">
      <div class="hero-media">${heroVideo}</div>
      <div class="container hero-content">
        <span class="eyebrow reveal">Produção Audiovisual · Salvador, BA</span>
        <h1 class="reveal reveal-delay-1">${heroHeadlineHtml(settings.hero_headline)}</h1>
        <p class="lead reveal reveal-delay-2">${escapeHtml(settings.hero_subheadline)}</p>
        <div class="btn-row reveal reveal-delay-3">
          <a href="/portfolio" class="btn btn-solid">Ver portfólio</a>
          <a href="/contato" class="btn btn-outline">Entrar em contato</a>
        </div>
      </div>
      <div class="hero-scroll"><span>Role</span><span class="line"></span></div>
    </section>

    ${featured ? `
    <section>
      <div class="container">
        <span class="eyebrow reveal">Projeto em destaque</span>
        <div class="section-head reveal">
          <h2>${escapeHtml(featured.title)}</h2>
          <a href="/portfolio/${escapeHtml(featured.slug)}" class="btn btn-accent">Assistir projeto</a>
        </div>
        <a href="/portfolio/${escapeHtml(featured.slug)}" class="work-card reveal" style="aspect-ratio:21/9;">
          <img src="${escapeHtml(coverUrl(featured))}" alt="${escapeHtml(featured.title)}" loading="lazy">
          <span class="play"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
          <span class="overlay"><span class="cat">${escapeHtml(featured.category_name || '')}</span><h3>${escapeHtml(featured.title)}</h3></span>
        </a>
      </div>
    </section>` : ''}

    <section class="alt-bg">
      <div class="container">
        <div class="section-head reveal">
          <div>
            <span class="eyebrow">Trabalhos recentes</span>
            <h2>Portfólio selecionado</h2>
          </div>
          <a href="/portfolio" class="btn btn-outline">Ver tudo</a>
        </div>
        ${recent.length ? `<div class="work-grid">${recent.map((p, i) => workCard(p, { tall: i === 0 })).join('')}</div>`
          : `<div class="empty-state">Novos projetos em breve.</div>`}
      </div>
    </section>

    ${categories.length ? `
    <section>
      <div class="container">
        <div class="section-head reveal"><div><span class="eyebrow">Explore</span><h2>Categorias</h2></div></div>
        <div class="filter-bar reveal">
          ${categories.map((c) => `<a href="/portfolio/${escapeHtml(c.slug)}" class="filter-pill">${escapeHtml(c.name)}</a>`).join('')}
        </div>
      </div>
    </section>` : ''}

    <section class="alt-bg">
      <div class="container about-split">
        <img class="reveal" src="/img/about-placeholder.jpg" alt="NJFILMES">
        <div class="reveal">
          <span class="eyebrow">A NJFILMES</span>
          <h2>Cinema, no seu momento mais importante</h2>
          <p>Produzimos vídeos, fotografia e cobertura de eventos com um olhar autoral — do casamento ao clipe, do institucional ao conteúdo para redes sociais. Cada projeto é tratado como uma produção própria, do roteiro à entrega final.</p>
          <a href="/sobre" class="btn btn-accent">Conheça a história</a>
        </div>
      </div>
    </section>

    ${services.length ? `
    <section>
      <div class="container">
        <div class="section-head reveal"><div><span class="eyebrow">O que fazemos</span><h2>Serviços</h2></div><a href="/servicos" class="btn btn-outline">Ver todos</a></div>
        <div class="services-grid">
          ${services.map((s, i) => `<div class="service-card reveal">
            <span class="num">0${i + 1}</span>
            <h3>${escapeHtml(s.title)}</h3>
            <p>${escapeHtml(truncate(s.description, 120))}</p>
          </div>`).join('')}
        </div>
      </div>
    </section>` : ''}

    ${marqueeChips.length ? `
    <section class="alt-bg">
      <div class="container">
        <span class="eyebrow reveal text-center" style="display:block;text-align:center;">Conheça alguns</span>
        <h2 class="reveal text-center">Clientes</h2>
        <div class="marquee reveal">
          <div class="marquee-track">
            ${[...marqueeChips, ...marqueeChips].join('')}
          </div>
        </div>
      </div>
    </section>` : ''}

    ${testimonialCards.length ? `
    <section>
      <div class="container">
        <span class="eyebrow reveal text-center" style="display:block;text-align:center;">O que dizem</span>
        <h2 class="reveal text-center">Feedback de clientes</h2>
        <div class="testimonials-scroll">
          ${testimonialCards.join('')}
        </div>
      </div>
    </section>` : ''}

    <section class="cta-section alt-bg">
      <div class="container">
        <span class="eyebrow reveal">Vamos gravar sua história?</span>
        <h2 class="reveal">Solicite um orçamento sem compromisso</h2>
        <div class="btn-row reveal">
          <a href="/contato" class="btn btn-solid">Pedir orçamento</a>
        </div>
      </div>
    </section>
  `;

  res.end(
    layout({
      title: null,
      description: settings.meta_description,
      path: '/',
      settings,
      categories,
      content,
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'ProfessionalService',
        name: settings.site_name,
        description: settings.meta_description,
        areaServed: 'Salvador, BA',
      },
    })
  );
}

export function portfolioIndexPage(req, res) {
  const settings = getSettings();
  const categories = listCategories();
  const projects = listProjects({ onlyPublished: true });

  const content = `
    <section class="simple-hero">
      <div class="container">
        <span class="eyebrow reveal">Portfólio</span>
        <h1 class="reveal">Trabalhos NJFILMES</h1>
        <p class="lead reveal">Filtre por categoria para ver casamentos, eventos, videoclipes, drone e muito mais.</p>
      </div>
    </section>
    <section style="padding-top:0;">
      <div class="container">
        <div class="filter-bar reveal" data-filter-bar>
          <button class="filter-pill active" data-cat="all">Todos</button>
          ${categories.map((c) => `<button class="filter-pill" data-cat="${escapeHtml(c.slug)}">${escapeHtml(c.name)}</button>`).join('')}
        </div>
        ${projects.length ? `<div class="work-grid">${projects.map((p) => workCard(p)).join('')}</div>`
          : `<div class="empty-state">Nenhum projeto publicado ainda. Assim que você adicionar pelo painel administrativo, eles aparecem aqui.</div>`}
      </div>
    </section>`;

  res.end(
    layout({
      title: 'Portfólio',
      description: 'Confira os trabalhos de vídeo, fotografia e drone da NJFILMES.',
      path: '/portfolio',
      settings,
      categories,
      content,
    })
  );
}

export function categoryOrProjectPage(req, res) {
  const slug = req.params.slug;
  const settings = getSettings();
  const categories = listCategories();

  const category = getCategoryBySlug(slug);
  if (category) {
    const projects = listProjects({ onlyPublished: true, categoryId: category.id });
    const content = `
      <section class="simple-hero">
        <div class="container">
          <span class="eyebrow reveal">Portfólio</span>
          <h1 class="reveal">${escapeHtml(category.name)}</h1>
        </div>
      </section>
      <section style="padding-top:0;">
        <div class="container">
          <div class="filter-bar reveal">
            <a href="/portfolio" class="filter-pill">Todos</a>
            ${categories.map((c) => `<a href="/portfolio/${escapeHtml(c.slug)}" class="filter-pill ${c.id === category.id ? 'active' : ''}">${escapeHtml(c.name)}</a>`).join('')}
          </div>
          ${projects.length ? `<div class="work-grid">${projects.map((p) => workCard(p)).join('')}</div>`
            : `<div class="empty-state">Nenhum projeto publicado nesta categoria ainda.</div>`}
        </div>
      </section>`;
    return res.end(
      layout({
        title: category.name,
        description: `Trabalhos de ${category.name} produzidos pela NJFILMES.`,
        path: `/portfolio/${category.slug}`,
        settings,
        categories,
        content,
      })
    );
  }

  const project = getProjectBySlug(slug);
  if (project && project.published) {
    return projectPage(req, res, project, settings, categories);
  }

  res.statusCode = 404;
  res.end(
    layout({
      title: 'Página não encontrada',
      description: 'Conteúdo não encontrado.',
      path: req.url,
      settings,
      categories,
      noindex: true,
      content: `<section class="simple-hero text-center"><div class="container"><h1>404</h1><p>Esse conteúdo não existe ou foi removido.</p><a href="/portfolio" class="btn btn-solid">Voltar ao portfólio</a></div></section>`,
    })
  );
}

function projectPage(req, res, project, settings, categories) {
  const mainVideo = project.videos[0];
  const otherPhotos = project.photos;

  const content = `
    <section class="project-hero">
      <div class="container">
        ${project.category_name ? `<span class="eyebrow reveal">${escapeHtml(project.category_name)}</span>` : ''}
        <h1 class="reveal">${escapeHtml(project.title)}</h1>
        <div class="project-meta reveal">
          ${project.project_date ? `<div><b>Data</b>${escapeHtml(formatDatePtBr(project.project_date))}</div>` : ''}
          ${project.location ? `<div><b>Local</b>${escapeHtml(project.location)}</div>` : ''}
          ${project.category_name ? `<div><b>Categoria</b>${escapeHtml(project.category_name)}</div>` : ''}
        </div>
      </div>
    </section>

    ${mainVideo ? `<section style="padding-top:0;"><div class="container reveal">${videoEmbedHtml(mainVideo)}</div></section>` : ''}

    ${project.description ? `<section style="padding-top:0;"><div class="container reveal" style="max-width:820px;"><p style="font-size:1.05rem;">${nl2br(project.description)}</p></div></section>` : ''}

    ${project.videos.length > 1 ? `<section class="alt-bg"><div class="container">
      <h3 class="reveal">Mais vídeos</h3>
      <div class="work-grid">${project.videos.slice(1).map((v) => `<div class="reveal">${videoEmbedHtml(v)}</div>`).join('')}</div>
    </div></section>` : ''}

    ${otherPhotos.length ? `<section class="${project.videos.length ? 'alt-bg' : ''}">
      <div class="container">
        <h3 class="reveal">Galeria</h3>
        <div class="gallery-grid reveal" data-lightbox-source>
          ${otherPhotos.map((p) => `<button type="button" data-lightbox-trigger data-full="${escapeHtml(p.filename)}" data-caption="${escapeHtml(p.caption || project.title)}">
            <img src="${escapeHtml(p.thumb_filename)}" alt="${escapeHtml(p.caption || project.title)}" loading="lazy">
          </button>`).join('')}
        </div>
      </div>
    </section>` : ''}

    ${project.credits || project.additional_info ? `<section>
      <div class="container reveal" style="max-width:820px;">
        ${project.credits ? `<p><b>Créditos:</b> ${escapeHtml(project.credits)}</p>` : ''}
        ${project.additional_info ? `<p>${nl2br(project.additional_info)}</p>` : ''}
      </div>
    </section>` : ''}

    <section class="cta-section alt-bg">
      <div class="container">
        <h2 class="reveal">Gostou? Vamos criar o seu projeto</h2>
        <div class="btn-row reveal"><a href="/contato" class="btn btn-solid">Solicitar orçamento</a><a href="/portfolio" class="btn btn-outline">Ver mais trabalhos</a></div>
      </div>
    </section>

    <div class="lightbox" data-lightbox>
      <button class="lightbox-close" data-lightbox-close aria-label="Fechar">&times;</button>
      <button class="lightbox-prev" data-lightbox-prev aria-label="Anterior">&#8249;</button>
      <img src="" alt="">
      <button class="lightbox-next" data-lightbox-next aria-label="Próxima">&#8250;</button>
      <span class="lightbox-counter" data-lightbox-counter></span>
    </div>
  `;

  res.end(
    layout({
      title: project.title,
      description: truncate(project.description || `${project.title} — um projeto NJFILMES.`, 160),
      path: `/portfolio/${project.slug}`,
      ogImage: project.cover_photo,
      settings,
      categories,
      content,
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'CreativeWork',
        name: project.title,
        description: project.description || '',
        datePublished: project.project_date || undefined,
      },
    })
  );
}

export function aboutPage(req, res) {
  const settings = getSettings();
  const categories = listCategories();
  const bio = getBio();
  const specialties = (bio.specialties || '')
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
  const totalProjects = listProjects({ onlyPublished: true }).length;
  const people = listPeople();

  // Galeria de bastidores (fotos do NJ trabalhando) que rola sozinha na horizontal,
  // igual a faixa de clientes/marcas — pedido do usuario em 29/08/2026.
  const bioGalleryImages = [
    '/img/bio/bio-1.jpg',
    '/img/bio/bio-2.jpg',
    '/img/bio/bio-3.jpg',
    '/img/bio/bio-4.jpg',
    '/img/bio/bio-5.jpg',
    '/img/bio/bio-6.jpg',
    '/img/bio/bio-7.jpg',
    '/img/bio/bio-8.jpg',
    '/img/bio/bio-9.jpg',
    '/img/bio/bio-10.jpg',
    '/img/bio/bio-11.jpg',
  ];

  const content = `
    <section class="simple-hero">
      <div class="container about-split">
        <div class="about-photos reveal"><div class="about-photos-track"><img class="about-photo-main" src="${escapeHtml(bio.profile_photo || '/img/about-placeholder.jpg')}" alt="${escapeHtml(bio.name || 'NJFILMES')}"><img class="about-photo-second" src="/img/about-photo-2.jpg" alt="${escapeHtml(bio.name || 'NJFILMES')}"></div></div>
        <div class="reveal">
          <span class="eyebrow">Sobre a NJFILMES</span>
          <h1>${escapeHtml(bio.name || 'NJFILMES')}</h1>
          ${bio.professional_title ? `<p class="lead">${escapeHtml(bio.professional_title)}</p>` : ''}
          ${bio.biography ? `<p>${nl2br(bio.biography)}</p>` : ''}
          <div class="stats-row">
            <div class="stat"><b>${totalProjects}+</b><span>Projetos</span></div>
            <div class="stat"><b>2015</b><span>Desde</span></div>
            <div class="stat"><b>BA</b><span>Salvador</span></div>
          </div>
          ${specialties.length ? `<div class="specialties-list">${specialties.map((s) => `<span>${escapeHtml(s)}</span>`).join('')}</div>` : ''}
          <div class="btn-row" style="margin-top:32px;"><a href="/contato" class="btn btn-solid">${escapeHtml(bio.cta_text || 'Vamos criar algo juntos?')}</a></div>
        </div>
      </div>
    </section>

    <section class="alt-bg">
      <div class="container">
        <span class="eyebrow reveal text-center" style="display:block;text-align:center;">Bastidores</span>
        <h2 class="reveal text-center">No set com a NJFILMES</h2>
        <div class="bio-gallery reveal">
          <div class="bio-gallery-track">
            ${[...bioGalleryImages, ...bioGalleryImages].map((src) => `<div class="bio-gallery-item"><img src="${escapeHtml(src)}" alt="NJFILMES nos bastidores" loading="lazy"></div>`).join('')}
          </div>
        </div>
      </div>
    </section>

    ${bio.trajectory ? `<section><div class="container" style="max-width:820px;">
      <span class="eyebrow reveal">Trajetória</span>
      <h2 class="reveal">Uma jornada pela imagem</h2>
      <p class="reveal">${nl2br(bio.trajectory)}</p>
    </div></section>` : ''}

    ${bio.equipment ? `<section class="${bio.trajectory ? 'alt-bg' : ''}"><div class="container" style="max-width:820px;">
      <span class="eyebrow reveal">Estrutura</span>
      <h2 class="reveal">Equipamentos</h2>
      <p class="reveal">${nl2br(bio.equipment)}</p>
    </div></section>` : ''}

    ${people.length ? `<section class="${(bio.trajectory ? 1 : 0) + (bio.equipment ? 1 : 0) === 1 ? 'alt-bg' : ''}">
      <div class="container">
        <span class="eyebrow reveal">Quem já passou pela câmera</span>
        <h2 class="reveal">Pessoas que já trabalhei</h2>
        <div class="people-grid">
          ${people.map((p) => `<div class="person-card reveal">
            <img src="${escapeHtml(p.photo)}" alt="${escapeHtml(p.name)}" loading="lazy">
            <div class="person-info">
              <b>${escapeHtml(p.name)}</b>
              ${p.role ? `<span>${escapeHtml(p.role)}</span>` : ''}
            </div>
          </div>`).join('')}
        </div>
      </div>
    </section>` : ''}

    <section class="cta-section alt-bg">
      <div class="container">
        <h2 class="reveal">Fale agora com a NJFILMES</h2>
        <div class="btn-row reveal"><a href="/contato" class="btn btn-solid">Entrar em contato</a></div>
      </div>
    </section>`;

  res.end(
    layout({
      title: 'Sobre',
      description: truncate(bio.biography || 'Conheça a história da NJFILMES.', 160),
      path: '/sobre',
      ogImage: bio.profile_photo,
      settings,
      categories,
      content,
    })
  );
}

export function servicesPage(req, res) {
  const settings = getSettings();
  const categories = listCategories();
  const services = listServices({ onlyPublished: true });

  const content = `
    <section class="simple-hero">
      <div class="container">
        <span class="eyebrow reveal">O que fazemos</span>
        <h1 class="reveal">Serviços</h1>
        <p class="lead reveal">Soluções completas em audiovisual, do planejamento à entrega final.</p>
      </div>
    </section>
    <section style="padding-top:0;">
      <div class="container">
        ${services.length ? `<div class="services-grid">
          ${services.map((s, i) => `<div class="service-card reveal">
            ${s.image ? `<img src="${escapeHtml(s.image)}" alt="${escapeHtml(s.title)}" loading="lazy">` : ''}
            <span class="num">0${i + 1}</span>
            <h3>${escapeHtml(s.title)}</h3>
            <p>${nl2br(s.description)}</p>
          </div>`).join('')}
        </div>` : `<div class="empty-state">Serviços em breve.</div>`}
      </div>
    </section>
    <section class="cta-section alt-bg">
      <div class="container">
        <h2 class="reveal">Pronto para começar seu projeto?</h2>
        <div class="btn-row reveal"><a href="/contato" class="btn btn-solid">Solicitar orçamento</a></div>
      </div>
    </section>`;

  res.end(
    layout({
      title: 'Serviços',
      description: 'Produção de vídeo, fotografia, drone, casamentos, eventos, videoclipes e institucional.',
      path: '/servicos',
      settings,
      categories,
      content,
    })
  );
}

export function contactPage(req, res) {
  const settings = getSettings();
  const categories = listCategories();
  const links = listLinks();
  const digits = String(settings.whatsapp_number || '').replace(/\D/g, '');
  const waUrl = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(settings.whatsapp_message || '')}` : null;

  const content = `
    <section class="simple-hero">
      <div class="container">
        <span class="eyebrow reveal">Contato</span>
        <h1 class="reveal">Vamos conversar sobre seu projeto</h1>
      </div>
    </section>
    <section style="padding-top:0;">
      <div class="container contact-grid">
        <div class="contact-card reveal">
          <h3>Orçamento rápido</h3>
          <p>A forma mais rápida de falar com a NJFILMES é pelo WhatsApp — conte um pouco sobre o seu evento, data e local que retornamos com uma proposta.</p>
          ${waUrl ? `<a href="${escapeHtml(waUrl)}" class="btn btn-solid" target="_blank" rel="noopener noreferrer">Falar no WhatsApp</a>`
            : `<p class="muted">Configure o número de WhatsApp no painel administrativo para ativar este botão.</p>`}
        </div>
        <div class="contact-card reveal">
          <h3>Outros canais</h3>
          <ul style="display:flex;flex-direction:column;gap:14px;"><li><a href="mailto:contato@njfilmes.com.br">contato@njfilmes.com.br</a></li>
          ${settings.instagram_url ? `<li><a href="${escapeHtml(settings.instagram_url)}" target="_blank" rel="noopener noreferrer">Instagram</a></li>` : ''}
          ${settings.youtube_url ? `<li><a href="${escapeHtml(settings.youtube_url)}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="opacity:0.7;flex-shrink:0;"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.6V8.4L15.8 12Z"/></svg>YouTube</a></li>` : ''}
          ${settings.vimeo_url ? `<li><a href="${escapeHtml(settings.vimeo_url)}" target="_blank" rel="noopener noreferrer">Vimeo</a></li>` : ''}
          ${settings.tiktok_url ? `<li><a href="${escapeHtml(settings.tiktok_url)}" target="_blank" rel="noopener noreferrer">TikTok</a></li>` : ''}
          ${settings.facebook_url ? `<li><a href="${escapeHtml(settings.facebook_url)}" target="_blank" rel="noopener noreferrer">Facebook</a></li>` : ''}
          ${links.map((l) => `<li><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.name)}</a></li>`).join('')}
          </ul>
        </div>
      </div>
    </section>`;

  res.end(
    layout({
      title: 'Contato',
      description: 'Fale com a NJFILMES pelo WhatsApp ou redes sociais.',
      path: '/contato',
      settings,
      categories,
      content,
    })
  );
}
