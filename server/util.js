// Funções utilitárias compartilhadas pelo servidor.
import { queryOne } from './db.js';

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

export async function uniqueSlug(table, base, ignoreId = null) {
  let slug = slugify(base) || 'item';
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const row = ignoreId
      ? await queryOne(`SELECT id FROM ${table} WHERE slug = $1 AND id != $2`, [slug, ignoreId])
      : await queryOne(`SELECT id FROM ${table} WHERE slug = $1`, [slug]);
    if (!row) return slug;
    n += 1;
    slug = `${slugify(base)}-${n}`;
  }
}

// Detecta provedor de vídeo (YouTube/Vimeo) a partir de uma URL colada pelo usuário e extrai o ID,
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

  // Serviços de armazenamento/compartilhamento de arquivo. Quando dá pra converter o link em
  // algo que toca direto na página (embed/arquivo bruto) fazemos isso; quando o serviço não
  // permite (caso do WeTransfer, e links do Mega em formatos antigos), caímos num botão de
  // link em vez de mostrar um iframe/branco quebrado.

  // Mega: link moderno "mega.nz/file/ID#CHAVE" tem uma versão de embed oficial em
  // "mega.nz/embed/ID#CHAVE" que toca dentro de um iframe.
  m = clean.match(/mega\.(?:nz|co\.nz)\/file\/([a-zA-Z0-9_-]+)(#[a-zA-Z0-9_-]+)?/i);
  if (m) {
    const megaId = `${m[1]}${m[2] || ''}`;
    return { provider: 'mega-embed', videoId: megaId, url: clean, embedUrl: `https://mega.nz/embed/${megaId}`, providerLabel: 'Mega' };
  }
  if (/mega\.(nz|co\.nz)\//i.test(clean)) {
    // Formato antigo (mega.nz/#!id!chave) ou pasta — não dá pra converter com segurança.
    return { provider: 'linkonly', videoId: '', url: clean, embedUrl: clean, providerLabel: 'Mega' };
  }

  // Google Drive: um link de arquivo (.../file/d/ID/view) tem uma versão "/preview" que
  // funciona em iframe, desde que o arquivo esteja compartilhado como "qualquer pessoa com o link".
  m = clean.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i);
  if (m) {
    return { provider: 'drive-embed', videoId: m[1], url: clean, embedUrl: `https://drive.google.com/file/d/${m[1]}/preview`, providerLabel: 'Google Drive' };
  }
  if (/drive\.google\.com\//i.test(clean)) {
    return { provider: 'linkonly', videoId: '', url: clean, embedUrl: clean, providerLabel: 'Google Drive' };
  }

  // Dropbox: trocando dl=0 por raw=1 o link vira o arquivo de vídeo puro, que dá pra usar
  // direto numa tag <video>. Só fazemos isso se a URL realmente aponta pra um arquivo de vídeo.
  if (/dropbox\.com\//i.test(clean) && /\.(mp4|webm|mov|m3u8)(\?|$)/i.test(clean)) {
    let raw = clean;
    if (/[?&]dl=[01]/i.test(raw)) raw = raw.replace(/([?&])dl=[01]/i, '$1raw=1');
    else raw += raw.includes('?') ? '&raw=1' : '?raw=1';
    return { provider: 'file', videoId: '', url: raw, embedUrl: raw, providerLabel: 'Dropbox' };
  }
  if (/dropbox\.com\//i.test(clean)) {
    return { provider: 'linkonly', videoId: '', url: clean, embedUrl: clean, providerLabel: 'Dropbox' };
  }

  // WeTransfer: links são temporários (expiram em alguns dias) e o serviço não permite embed
  // — não dá pra tocar isso dentro da página de forma confiável, por isso fica como botão.
  if (/wetransfer\.com\//i.test(clean)) {
    return { provider: 'linkonly', videoId: '', url: clean, embedUrl: clean, providerLabel: 'WeTransfer' };
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
  if (video.provider === 'mega-embed' && videoId) return `https://mega.nz/embed/${videoId}`;
  if (video.provider === 'drive-embed' && videoId) return `https://drive.google.com/file/d/${videoId}/preview`;
  return video.url || '';
}

function guessLinkLabel(url) {
  const u = String(url || '');
  if (/mega\.(nz|co\.nz)/i.test(u)) return 'Mega';
  if (/drive\.google\.com/i.test(u)) return 'Google Drive';
  if (/wetransfer\.com/i.test(u)) return 'WeTransfer';
  if (/dropbox\.com/i.test(u)) return 'Dropbox';
  return 'link externo';
}

export function videoEmbedHtml(video, opts = {}) {
  const { className = 'video-embed' } = opts;
  if (!video) return '';
  if (video.provider === 'youtube' || video.provider === 'vimeo') {
    return `<div class="${className}"><iframe src="${escapeHtml(videoEmbedUrl(video))}" title="${escapeHtml(video.title || 'Vídeo')}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
  }
  if (video.provider === 'mega-embed' || video.provider === 'drive-embed') {
    // Embed automático de Mega/Drive: toca dentro da página. Depende do arquivo estar com
    // permissão pública ("qualquer pessoa com o link"); por isso deixamos um link de reserva
    // logo abaixo, caso o embed apareça em branco por causa de permissão.
    return `<div class="${className}"><iframe src="${escapeHtml(videoEmbedUrl(video))}" title="${escapeHtml(video.title || 'Vídeo')}" frameborder="0" allow="autoplay" allowfullscreen loading="lazy"></iframe></div>
    <p class="video-embed-fallback"><a href="${escapeHtml(video.url)}" target="_blank" rel="noopener noreferrer">O vídeo não carregou? Abrir no ${escapeHtml(video.providerLabel || guessLinkLabel(video.url))} ↗</a></p>`;
  }
  if (video.provider === 'file') {
    return `<div class="${className}"><video controls preload="metadata" playsinline src="${escapeHtml(video.url)}"></video></div>`;
  }
  if (video.provider === 'linkonly') {
    const label = video.providerLabel || guessLinkLabel(video.url);
    return `<div class="${className} video-embed-linkonly">
      <a href="${escapeHtml(video.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-solid">
        ${video.title ? escapeHtml(video.title) + ' — ' : ''}Assistir/baixar no ${escapeHtml(label)}
      </a>
    </div>`;
  }
  return `<div class="${className}"><iframe src="${escapeHtml(video.url)}" title="${escapeHtml(video.title || 'Vídeo')}" frameborder="0" allowfullscreen loading="lazy"></iframe></div>`;
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
