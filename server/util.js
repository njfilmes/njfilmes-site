// Funções utilitárias compartilhadas pelo servidor.

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Converte quebras de linha em <br> preservando o escape de HTML (para textos longos como biografia/descrição).
export function nl2br(str) {
  return escapeHtml(str).replaceAll('\n', '<br>');
}

export function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function uniqueSlug(db, table, base, ignoreId = null) {
  let slug = slugify(base) || 'item';
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const row = ignoreId
      ? db.prepare(`SELECT id FROM ${table} WHERE slug = ? AND id != ?`).get(slug, ignoreId)
      : db.prepare(`SELECT id FROM ${table} WHERE slug = ?`).get(slug);
    if (!row) return slug;
    n += 1;
    slug = `${slugify(base)}-${n}`;
  }
}

// Detecta provedor de vídeo (YouTube/Vimeo/Mega) a partir de uma URL colada pelo usuário e extrai o ID,
// para permitir embed automático responsivo.
export function parseVideoUrl(url) {
  const clean = String(url || '').trim();
  if (!clean) return null;

  // YouTube: várias formas possíveis de URL
  let m = clean.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{6,})/);
  if (m) {
    return { provider: 'youtube', videoId: m[1], url: clean, embedUrl: `https://www.youtube.com/embed/${m[1]}` };
  }

  // Vimeo
  m = clean.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) {
    return { provider: 'vimeo', videoId: m[1], url: clean, embedUrl: `https://player.vimeo.com/video/${m[1]}` };
  }

  // Mega.nz: link de compartilhamento de arquivo (/file/ID#CHAVE) é convertido para o
  // link de embed oficial do Mega (/embed/ID#CHAVE), que funciona dentro de um iframe.
  m = clean.match(/mega\.nz\/(?:file|embed)\/([a-zA-Z0-9_-]+)#([a-zA-Z0-9_-]+)/);
  if (m) {
    return { provider: 'mega', videoId: m[1], url: clean, embedUrl: `https://mega.nz/embed/${m[1]}#${m[2]}` };
  }

  // Link direto para arquivo de vídeo hospedado externamente
  if (/\.(mp4|webm|mov|m3u8)(\?.*)?$/i.test(clean)) {
    return { provider: 'file', videoId: '', url: clean, embedUrl: clean };
  }

  // Qualquer outra URL externa (ex.: player de terceiros)
  if (/^https?:\/\//i.test(clean)) {
    return { provider: 'external', videoId: '', url: clean, embedUrl: clean };
  }

  return null;
}

export function videoEmbedUrl(video) {
  if (!video) return '';
  if (video.embed_url) return video.embed_url;
  if (video.embedUrl) return video.embedUrl;
  const videoId = video.video_id || video.videoId;
  if (video.provider === 'youtube' && videoId) return `https://www.youtube.com/embed/${videoId}`;
  if (video.provider === 'vimeo' && videoId) return `https://player.vimeo.com/video/${videoId}`;
  if (video.provider === 'mega' && videoId && (video.video_key || video.videoKey)) {
    return `https://mega.nz/embed/${videoId}#${video.video_key || video.videoKey}`;
  }
  return video.url || '';
}

export function videoEmbedHtml(video, opts = {}) {
  const { className = 'video-embed' } = opts;
  if (!video) return '';
  if (video.provider === 'youtube' || video.provider === 'vimeo') {
    return `<div class="${className}"><iframe src="${escapeHtml(videoEmbedUrl(video))}" title="${escapeHtml(video.title || 'Vídeo')}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
  }
  if (video.provider === 'file') {
    return `<div class="${className}"><video controls preload="metadata" playsinline src="${escapeHtml(video.url)}"></video></div>`;
  }
  return `<div class="${className}"><iframe src="${escapeHtml(videoEmbedUrl(video) || video.url)}" title="${escapeHtml(video.title || 'Vídeo')}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
}

export function formatDatePtBr(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + (isoDate.length === 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function truncate(str, len = 160) {
  const s = String(str || '').replace(/\s+/g, ' ').trim();
  if (s.length <= len) return s;
  return s.slice(0, len - 1).trimEnd() + '…';
}

export function onlyDigits(str) {
  return String(str || '').replace(/\D/g, '');
}
