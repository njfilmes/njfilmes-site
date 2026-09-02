// Upload real de imagens: recebe o arquivo (base64 vindo do navegador), otimiza e gera thumbnail
// com sharp (já instalado neste ambiente).
//
// Armazenamento: em produção as fotos vão pro Vercel Blob (BLOB_READ_WRITE_TOKEN definido),
// porque o disco do Render no plano gratuito é apagado a cada deploy/reinício — sem isso, as
// fotos cadastradas pelo painel sumiriam. Se essa variável não estiver definida (por exemplo,
// rodando localmente sem uma conta Vercel configurada), o upload cai automaticamente pro disco
// local em public/uploads, exatamente como antes — útil só para desenvolvimento/testes.
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');
export const PHOTOS_DIR = path.join(UPLOADS_DIR, 'photos');
export const THUMBS_DIR = path.join(UPLOADS_DIR, 'thumbs');
export const MISC_DIR = path.join(UPLOADS_DIR, 'misc');

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';

if (!BLOB_TOKEN) {
  for (const dir of [UPLOADS_DIR, PHOTOS_DIR, THUMBS_DIR, MISC_DIR]) {
    await fs.mkdir(dir, { recursive: true });
  }
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB por foto (antes da otimização)

// Salva um buffer já processado, no Vercel Blob (produção) ou em disco (modo local de
// desenvolvimento). Devolve a URL final a ser usada em <img src="...">: absoluta (Vercel Blob)
// ou relativa ao site (/uploads/...), igual ao comportamento original.
async function uploadBuffer(buffer, pathname, contentType) {
  if (BLOB_TOKEN) {
    const { put } = await import('@vercel/blob');
    const blob = await put(pathname, buffer, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      token: BLOB_TOKEN,
    });
    return blob.url;
  }
  const abs = path.join(UPLOADS_DIR, pathname);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
  return `/uploads/${pathname}`;
}

async function deleteBlobOrFile(urlOrPath) {
  if (!urlOrPath) return;
  if (BLOB_TOKEN && /^https?:\/\//i.test(urlOrPath)) {
    try {
      const { del } = await import('@vercel/blob');
      await del(urlOrPath, { token: BLOB_TOKEN });
    } catch {
      // já pode não existir mais; ignora
    }
    return;
  }
  const abs = path.join(__dirname, '..', 'public', String(urlOrPath).replace(/^\//, ''));
  try {
    await fs.unlink(abs);
  } catch {
    // arquivo pode já não existir; ignora
  }
}

// dataUrl no formato "data:image/jpeg;base64,....."
export async function saveProjectPhoto(dataUrl, originalName = 'foto') {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(dataUrl || '');
  if (!match) throw new Error('Formato de imagem inválido. Envie um arquivo de imagem (JPG, PNG ou WEBP).');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error('Arquivo muito grande. O limite é 20MB por foto.');
  }

  const id = crypto.randomBytes(8).toString('hex');

  // Imagem principal: redimensiona para no máximo 2200px no maior lado, comprime em WEBP
  // preservando boa qualidade (equilíbrio entre qualidade e performance de carregamento).
  const mainBuffer = await sharp(buffer, { failOn: 'none' })
    .rotate() // corrige orientação EXIF automaticamente
    .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  // Thumbnail leve para grids/portfólio (lazy loading rápido)
  const thumbBuffer = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: 640, height: 640, fit: 'cover', position: 'attention' })
    .webp({ quality: 70 })
    .toBuffer();

  const filename = await uploadBuffer(mainBuffer, `photos/${id}.webp`, 'image/webp');
  const thumbFilename = await uploadBuffer(thumbBuffer, `thumbs/${id}-thumb.webp`, 'image/webp');

  return { filename, thumbFilename };
}

export async function saveMiscImage(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(dataUrl || '');
  if (!match) throw new Error('Formato de imagem inválido.');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error('Arquivo muito grande (limite 20MB).');
  const id = crypto.randomBytes(8).toString('hex');
  const outBuffer = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 84 })
    .toBuffer();
  return uploadBuffer(outBuffer, `misc/${id}.webp`, 'image/webp');
}

export async function deletePhotoFiles(filename, thumbFilename) {
  await deleteBlobOrFile(filename);
  await deleteBlobOrFile(thumbFilename);
}
