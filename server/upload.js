// Upload real de imagens: recebe o arquivo (base64 vindo do navegador), otimiza com sharp
// e salva as fotos. Se a variável de ambiente BLOB_READ_WRITE_TOKEN estiver configurada,
// as fotos vão para o Vercel Blob (armazenamento externo, permanente, funciona em qualquer
// hospedagem). Sem essa variável, cai de volta para salvar em disco local (uso em
// desenvolvimento, no seu computador).
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { put, del } from '@vercel/blob';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');
export const PHOTOS_DIR = path.join(UPLOADS_DIR, 'photos');
export const THUMBS_DIR = path.join(UPLOADS_DIR, 'thumbs');
export const MISC_DIR = path.join(UPLOADS_DIR, 'misc');

function useBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

if (!useBlob()) {
  for (const dir of [UPLOADS_DIR, PHOTOS_DIR, THUMBS_DIR, MISC_DIR]) {
    await fs.mkdir(dir, { recursive: true });
  }
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB por foto (antes da otimização)

function decodeDataUrl(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(dataUrl || '');
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  return buffer;
}

// Salva um buffer já otimizado, no Blob (se configurado) ou em disco local.
// `relPath` é o caminho relativo dentro de public/uploads, ex: "photos/abc.webp".
async function storeBuffer(buffer, relPath) {
  if (useBlob()) {
    const { url } = await put(`uploads/${relPath}`, buffer, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'image/webp',
    });
    return url;
  }
  const abs = path.join(UPLOADS_DIR, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
  return `/uploads/${relPath}`;
}

// dataUrl no formato "data:image/jpeg;base64,....."
export async function saveProjectPhoto(dataUrl, originalName = 'foto') {
  const buffer = decodeDataUrl(dataUrl);
  if (!buffer) throw new Error('Formato de imagem inválido. Envie um arquivo de imagem (JPG, PNG ou WEBP).');
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error('Arquivo muito grande. O limite é 20MB por foto.');
  }

  const id = crypto.randomBytes(8).toString('hex');
  const filename = `${id}.webp`;
  const thumbFilename = `${id}-thumb.webp`;

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

  const [photoUrl, thumbUrl] = await Promise.all([
    storeBuffer(mainBuffer, `photos/${filename}`),
    storeBuffer(thumbBuffer, `thumbs/${thumbFilename}`),
  ]);

  return {
    filename: photoUrl,
    thumbFilename: thumbUrl,
  };
}

export async function saveMiscImage(dataUrl) {
  const buffer = decodeDataUrl(dataUrl);
  if (!buffer) throw new Error('Formato de imagem inválido.');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error('Arquivo muito grande (limite 20MB).');
  const id = crypto.randomBytes(8).toString('hex');
  const filename = `${id}.webp`;
  const outBuffer = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 84 })
    .toBuffer();
  return storeBuffer(outBuffer, `misc/${filename}`);
}

export async function deletePhotoFiles(filename, thumbFilename) {
  const tryDelete = async (value) => {
    if (!value) return;
    if (/^https?:\/\//.test(value)) {
      try {
        await del(value);
      } catch {
        // já pode não existir no Blob; ignora
      }
      return;
    }
    const abs = path.join(__dirname, '..', 'public', value.replace(/^\//, ''));
    try {
      await fs.unlink(abs);
    } catch {
      // arquivo pode já não existir; ignora
    }
  };
  await tryDelete(filename);
  await tryDelete(thumbFilename);
}
