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
  listBioPhotos,
  listBioGalleryPhotos,
  incrementProjectViews,
  incrementProjectLikes,
} from '../queries.js';

function coverUrl(project) {
  return project.cover_photo || (project.photos && project.photos[0] && project.photos[0].filename) || '/img/placeholder.svg';
}

function workCard(project, opts = {}) {
  const cat = project.category_name || '';
  const hasVideo = Number(project.video_count) > 0;
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
// Pedido em 30/08/2026: dar uma "margem de respiro" antes da pontuação final
// (ex: o "?" de "papel?") - sem isso ela fica colada na última letra da
// palavra. Se a última palavra terminar em pontuação, ela agora vem separada
// num span próprio (.hero-punct) só pra poder dar esse espacinho via CSS,
// sem precisar mexer no resto da palavra.
function heroHeadlineHtml(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  const lastSpace = trimmed.lastIndexOf(' ');
  const wrapAccent = (word) => {
    const match = word.match(/^(.*?)([?!.,;:]+)$/);
    if (!match) return `<span class="text-accent">${escapeHtml(word)}</span>`;
    const [, core, punct] = match;
    return `<span class="text-accent">${escapeHtml(core)}<span class="hero-punct">${escapeHtml(punct)}</span></span>`;
  };
  if (lastSpace === -1) return wrapAccent(trimmed);
  const rest = trimmed.slice(0, lastSpace);
  const last = trimmed.slice(lastSpace + 1);
  return `${escapeHtml(rest)} ${wrapAccent(last)}`;
}

// Versao do arquivo do hero, usada como "carimbo" (?v=) na URL da foto/poster
// pra forcar navegadores e CDNs a buscarem a versao mais nova sempre que a
// foto for trocada pelo painel/commit, sem precisar de Ctrl+F5 no cliente.
const HERO_IMG_VERSION = '20260829b';

export async function homePage(req, res) {
  const settings = await getSettings();
  const categories = await listCategories();
  const featured = (await listProjects({ onlyPublished: true, featuredOnly: true, limit: 1 }))[0];
  const recent = (await listProjects({ onlyPublished: true, excludeHiddenFromRecent: true, limit: 7 })).filter((p) => !featured || p.id !== featured.id).slice(0, 6);
  const services = (await listServices({ onlyPublished: true })).slice(0, 6);
  const brands = await listBrands();
  const people = await listPeople();
  const testimonials = await listTestimonials();

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
      <span class="eyebrow reveal hero-eyebrow-lower">Produção Audiovisual · Salvador, BA</span>
      <h1 class="reveal reveal-delay-1">${heroHeadlineHtml(settings.hero_headline)}</h1>
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
        ${Number(featured.video_count) > 0 ? `<span class="play"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>` : ''}
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
    // A visualização não é somada aqui: a página do projeto passa a ser gerada como HTML
    // estático (sem código rodando a cada acesso) — quem soma é uma chamada fetch() do
    // navegador pra /api/visualizar/:slug assim que a página carrega (ver public/js/site.js).
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
// A visualização NÃO é somada aqui no render (a página pode ser servida como HTML estático);
// quem soma é uma chamada fetch() do navegador pra /api/visualizar/:slug logo que a página carrega
// (ver public/js/site.js) — aqui só mostramos o número já conhecido no momento da geração.
function likeViewsBlock(project) {
  return `<div class="video-actions reveal" data-views-block data-project="${escapeHtml(project.slug)}">
    <button type="button" class="video-like-btn" data-like-btn data-project="${escapeHtml(project.slug)}">
      <span class="heart"></span> <span data-like-count>${project.likes || 0}</span>
    </button>
    <span class="video-views"><span class="eye">👁</span> <span data-view-count>${project.views || 0}</span> <span data-view-word>${project.views === 1 ? 'visualização' : 'visualizações'}</span></span>
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
  const brands = await listBrands();

  // Pedido em 30/08/2026: seção "Marcas" (mesma faixa rolando sozinha pro lado
  // que já existia na home, só que aqui na Sobre com só as marcas, sem
  // misturar com pessoas - fica logo abaixo de "Pessoas que já trabalhei").
  // Alterna o fundo (alt-bg) acompanhando a mesma lógica em zebra que as
  // seções anteriores da página já usam, pra continuar intercalando certinho
  // mesmo quando trajetória/equipamentos estão vazios e somem da página.
  let altBgToggle = true; // true = fundo alt-bg (a galeria de bastidores acima já começa assim)
  if (bio.trajectory) altBgToggle = !altBgToggle;
  if (bio.equipment) altBgToggle = !altBgToggle;
  if (people.length) altBgToggle = !altBgToggle;
  const brandsAltBg = altBgToggle;

  // Fotos que ficam passando (crossfade) ao lado da biografia: a foto de perfil
  // primeiro, depois todas as fotos que o usuario enviar no painel em "Fotos da
  // pagina Sobre" — pedido do usuario em 30/08/2026 pra poder colocar mais de 2 fotos.
  const aboutPhotoUrls = [
    bio.profile_photo || '/img/about-placeholder.jpg',
    ...(await listBioPhotos()).map((p) => p.filename),
  ].filter((src, idx, arr) => src && arr.indexOf(src) === idx);

  // Galeria de bastidores (fotos do NJ trabalhando) que rola sozinha na horizontal,
  // igual a faixa de clientes/marcas — pedido do usuario em 29/08/2026. Editável pelo painel
  // (menu Biografia / Sobre) desde 02/09/2026 — antes eram 11 arquivos fixos no código.
  const bioGalleryImages = (await listBioGalleryPhotos()).map((p) => p.filename);

  const content = `
  <section class="simple-hero">
    <div class="container about-split">
      <div class="about-photos reveal">${aboutPhotoUrls.map((src, i) => `<img class="about-photo-slide${i === 0 ? ' is-active' : ''}" src="${escapeHtml(src)}" alt="${escapeHtml(bio.name || 'NJFILMES')}">`).join('')}</div>
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
        ${settings.youtube_url ? `<a href="${escapeHtml(settings.youtube_url)}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:6px;margin-top:16px;color:var(--fg-dim);font-size:0.85rem;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="opacity:0.8;flex-shrink:0;"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.6V8.4L15.8 12Z"/></svg>
          Ver no YouTube
        </a>` : ''}
      </div>
    </div>
  </section>

  ${bioGalleryImages.length ? `<section class="alt-bg">
    <div class="container">
      <span class="eyebrow reveal text-center" style="display:block;text-align:center;">Bastidores</span>
      <h2 class="reveal text-center">${escapeHtml(bio.gallery_title || 'No set com a NJFILMES')}</h2>
      <div class="bio-gallery reveal">
        <div class="bio-gallery-track">
          ${[...bioGalleryImages, ...bioGalleryImages].map((src) => `<div class="bio-gallery-item"><img src="${escapeHtml(src)}" alt="NJFILMES nos bastidores" loading="lazy"></div>`).join('')}
        </div>
      </div>
    </div>
  </section>` : ''}

  ${bio.trajectory ? `<section><div class="container" style="max-width:820px;">
    <span class="eyebrow reveal">Trajetória</span>
    <h2 class="reveal">${escapeHtml(bio.trajectory_title || 'Uma jornada pela imagem')}</h2>
    <p class="reveal">${nl2br(bio.trajectory)}</p>
  </div></section>` : ''}

  ${bio.equipment ? `<section class="${bio.trajectory ? 'alt-bg' : ''}"><div class="container" style="max-width:820px;">
    <span class="eyebrow reveal">Estrutura</span>
    <h2 class="reveal">Equipamentos</h2>
    <p class="reveal">${nl2br(bio.equipment)}</p>
  </div></section>` : ''}

  ${people.length ? `<section id="pessoas" class="${(bio.trajectory ? 1 : 0) + (bio.equipment ? 1 : 0) === 1 ? 'alt-bg' : ''}">
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

  ${brands.length ? `<section class="${brandsAltBg ? 'alt-bg' : ''}">
    <div class="container">
      <span class="eyebrow reveal text-center" style="display:block;text-align:center;">Quem confia no meu trabalho</span>
      <h2 class="reveal text-center">Marcas</h2>
      <div class="marquee reveal">
        <div class="marquee-track">
          ${[...brands, ...brands].map((b) => {
            const isPlainLogo = b.name === 'Rockhair Barbearia';
            return `<a class="brand-chip" href="${b.url ? escapeHtml(b.url) : '#'}" ${b.url ? 'target="_blank" rel="noopener noreferrer"' : 'tabindex="-1" style="pointer-events:none;"'}><div class="brand-chip-logo${isPlainLogo ? ' no-frame' : ''}"><img src="${escapeHtml(b.logo)}" alt="${escapeHtml(b.name)}" loading="lazy"></div><span>${escapeHtml(b.name)}</span></a>`;
          }).join('')}
        </div>
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
      <h1 class="reveal">${escapeHtml(settings.contact_headline || 'Vamos conversar sobre seu projeto')}</h1>
    </div>
  </section>
  <section style="padding-top:0;">
    <div class="container contact-grid">
      <div class="contact-card reveal">
        <h3>${escapeHtml(settings.contact_budget_title || 'Orçamento rápido')}</h3>
        <p>${escapeHtml(settings.contact_budget_text || 'A forma mais rápida de falar com a NJFILMES é pelo WhatsApp — conte um pouco sobre o seu evento, data e local que retornamos com uma proposta.')}</p>
        ${waUrl ? `<a href="${escapeHtml(waUrl)}" class="btn btn-solid" target="_blank" rel="noopener noreferrer">${escapeHtml(settings.contact_whatsapp_button_text || 'Falar no WhatsApp')}</a>`
          : `<p class="muted">Configure o número de WhatsApp no painel administrativo para ativar este botão.</p>`}
      </div>
      <div class="contact-card reveal">
        <h3>${escapeHtml(settings.contact_channels_title || 'Outros canais')}</h3>
        <ul style="display:flex;flex-direction:column;gap:14px;"><li><a href="mailto:${escapeHtml(settings.contact_email || 'contato@njfilmes.com.br')}">${escapeHtml(settings.contact_email || 'contato@njfilmes.com.br')}</a></li>
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
