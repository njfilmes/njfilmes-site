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
  incrementProjectViews,
  incrementProjectLikes,
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

export async function homePage(req, res) {
  const settings = await getSettings();
  const categories = await listCategories();
  const featuredList = await listProjects({ onlyPublished: true, featuredOnly: true, limit: 1 });
  const featured = featuredList[0];
  const recentAll = await listProjects({ onlyPublished: true, limit: 7 });
  const recent = recentAll.filter((p) => !featured || p.id !== featured.id).slice(0, 6);
  const services = (await listServices({ onlyPublished: true })).slice(0, 6);
  const brands = await listBrands();
  const people = (await listPeople()).slice(0, 8);

  const heroVideo = settings.hero_video_url
    ? `<video autoplay muted loop playsinline poster="/img/hero-poster.jpg" src="${escapeHtml(settings.hero_video_url)}"></video>`
    : `<img src="/img/hero-poster.jpg" alt="NJFILMES">`;

  const content = `
  <section class="hero">
    <div class="hero-media">${heroVideo}</div>
    <div class="container hero-content">
      <span class="eyebrow reveal">Produção Audiovisual · Salvador, BA</span>
      <h1 class="reveal reveal-delay-1">${escapeHtml(settings.hero_headline)}</h1>
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

  ${brands.length ? `
  <section class="alt-bg">
    <div class="container">
      <span class="eyebrow reveal text-center" style="display:block;text-align:center;">Conheça alguns</span>
      <h2 class="reveal text-center">Clientes</h2>
      <div class="marquee reveal">
        <div class="marquee-track">
          ${[...brands, ...brands].map((b) => `<a class="brand-chip" href="${b.url ? escapeHtml(b.url) : '#'}" ${b.url ? 'target="_blank" rel="noopener noreferrer"' : 'tabindex="-1" style="pointer-events:none;"'}><img src="${escapeHtml(b.logo)}" alt="${escapeHtml(b.name)}" loading="lazy"></a>`).join('')}
        </div>
      </div>
      ${people.length ? `
      <div class="people-strip">
        ${people.map((p) => `<div class="people-strip-item reveal">
          <img src="${escapeHtml(p.photo)}" alt="${escapeHtml(p.name)}" loading="lazy">
          <b>${escapeHtml(p.name)}</b>
          ${p.role ? `<span>${escapeHtml(p.role)}</span>` : ''}
        </div>`).join('')}
      </div>
      <div class="text-center" style="text-align:center;margin-top:28px;">
        <a href="/sobre#pessoas" class="btn btn-outline">Ver todas as pessoas</a>
      </div>` : ''}
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

export async function portfolioIndexPage(req, res) {
  const settings = await getSettings();
  const categories = await listCategories();
  const projects = await listProjects({ onlyPublished: true });

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

export async function categoryOrProjectPage(req, res) {
  const slug = req.params.slug;
  const settings = await getSettings();
  const categories = await listCategories();

  const category = await getCategoryBySlug(slug);
  if (category) {
    const projects = await listProjects({ onlyPublished: true, categoryId: category.id });
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

  const project = await getProjectBySlug(slug);
  if (project && project.published) {
    // A visualização não é mais somada aqui: a página do projeto passa a ser gerada como
    // HTML estático (sem código rodando a cada acesso), então quem soma é uma chamada
    // fetch() do navegador pra /api/visualizar/:slug assim que a página carrega.
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

// Botão de curtir + contador de visualizações, exibido logo abaixo do vídeo principal do projeto.
// A visualização NÃO é mais somada aqui no render (a página pode ser servida como HTML estático);
// quem soma é uma chamada fetch() do navegador pra /api/visualizar/:slug logo que a página carrega
// (ver public/js/site.js), então aqui só mostramos o número já conhecido no momento da geração.
function likeViewsBlock(project) {
  return `<div class="video-actions reveal" data-views-block data-project="${escapeHtml(project.slug)}">
    <button type="button" class="video-like-btn" data-like-btn data-project="${escapeHtml(project.slug)}">
      <span class="heart"></span> <span data-like-count>${project.likes || 0}</span>
    </button>
    <span class="video-views"><span class="eye">👁</span> <span data-view-count>${project.views || 0}</span> visualiza<span data-view-word>${project.views === 1 ? 'ção' : 'ções'}</span></span>
  </div>`;
}

// Endpoint chamado pelo botão de curtir (fetch via JS) — soma 1 curtida e devolve o total em JSON.
export async function likeProject(req, res, slug) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const project = await getProjectBySlug(slug);
  if (!project || !project.published) {
    res.statusCode = 404;
    return res.end(JSON.stringify({ error: 'Projeto não encontrado.' }));
  }
  const likes = await incrementProjectLikes(project.id);
  res.end(JSON.stringify({ likes }));
}

// Endpoint chamado automaticamente pelo navegador ao carregar a página do projeto (fetch via JS)
// — soma 1 visualização e devolve o total em JSON. Existe separado do render porque a página
// pública passará a ser HTML estático (gerado antecipadamente), sem código rodando a cada acesso.
export async function registerView(req, res, slug) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const project = await getProjectBySlug(slug);
  if (!project || !project.published) {
    res.statusCode = 404;
    return res.end(JSON.stringify({ error: 'Projeto não encontrado.' }));
  }
  const views = await incrementProjectViews(project.id);
  res.end(JSON.stringify({ views }));
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

  ${mainVideo ? `<section style="padding-top:0;"><div class="container reveal">
    ${videoEmbedHtml(mainVideo)}
    ${likeViewsBlock(project)}
  </div></section>` : ''}

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

export async function aboutPage(req, res) {
  const settings = await getSettings();
  const categories = await listCategories();
  const bio = await getBio();
  const specialties = (bio.specialties || '')
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
  const totalProjects = (await listProjects({ onlyPublished: true })).length;
  const people = await listPeople();

  const content = `
  <section class="simple-hero">
    <div class="container about-split">
      <img class="reveal" src="${escapeHtml(bio.profile_photo || '/img/about-placeholder.jpg')}" alt="${escapeHtml(bio.name || 'NJFILMES')}">
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

  ${bio.trajectory ? `<section class="alt-bg"><div class="container" style="max-width:820px;">
    <span class="eyebrow reveal">Trajetória</span>
    <h2 class="reveal">Uma jornada pela imagem</h2>
    <p class="reveal">${nl2br(bio.trajectory)}</p>
  </div></section>` : ''}

  ${bio.equipment ? `<section><div class="container" style="max-width:820px;">
    <span class="eyebrow reveal">Estrutura</span>
    <h2 class="reveal">Equipamentos</h2>
    <p class="reveal">${nl2br(bio.equipment)}</p>
  </div></section>` : ''}

  ${people.length ? `<section id="pessoas" class="${bio.trajectory || bio.equipment ? '' : 'alt-bg'}">
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

export async function servicesPage(req, res) {
  const settings = await getSettings();
  const categories = await listCategories();
  const services = await listServices({ onlyPublished: true });

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

export async function contactPage(req, res) {
  const settings = await getSettings();
  const categories = await listCategories();
  const links = await listLinks();
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
        <ul style="display:flex;flex-direction:column;gap:14px;">
          ${settings.contact_email ? `<li><a href="mailto:${escapeHtml(settings.contact_email)}">${escapeHtml(settings.contact_email)}</a></li>` : ''}
          ${settings.instagram_url ? `<li><a href="${escapeHtml(settings.instagram_url)}" target="_blank" rel="noopener noreferrer">Instagram</a></li>` : ''}
          ${settings.youtube_url ? `<li><a href="${escapeHtml(settings.youtube_url)}" target="_blank" rel="noopener noreferrer">YouTube</a></li>` : ''}
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
