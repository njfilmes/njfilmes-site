// Upload real de imagens: recebe o arquivo (base64 vindo do navegador), otimiza e gera thumbnail
// com sharp (já instalado neste ambiente), e salva em disco em public/uploads.
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

for (const dir of [UPLOADS_DIR, PHOTOS_DIR, THUMBS_DIR, MISC_DIR]) {
  await fs.mkdir(dir, { recursive: true });
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB por foto (antes da otimização)

// dataUrl no formato "data:image/jpeg;base64,....."
export async function saveProjectPhoto(dataUrl, originalName = 'foto') {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(dataUrl || '');
  if (!match) throw new Error('Formato de imagem inválido. Envie um arquivo de imagem (JPG, PNG ou WEBP).');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error('Arquivo muito grande. O limite é 20MB por foto.');
  }

  const id = crypto.randomBytes(8).toString('hex');
  const filename = `${id}.webp`;
  const thumbFilename = `${id}-thumb.webp`;

  // Imagem principal: redimensiona para no máximo 2200px no maior lado, comprime em WEBP
  // preservando boa qualidade (equilíbrio entre qualidade e performance de carregamento).
  await sharp(buffer, { failOn: 'none' })
    .rotate() // corrige orientação EXIF automaticamente
    .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(path.join(PHOTOS_DIR, filename));

  // Thumbnail leve para grids/portfólio (lazy loading rápido)
  await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: 640, height: 640, fit: 'cover', position: 'attention' })
    .webp({ quality: 70 })
    .toFile(path.join(THUMBS_DIR, thumbFilename));

  return {
    filename: `/uploads/photos/${filename}`,
    thumbFilename: `/uploads/thumbs/${thumbFilename}`,
  };
}

export async function saveMiscImage(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(dataUrl || '');
  if (!match) throw new Error('Formato de imagem inválido.');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error('Arquivo muito grande (limite 20MB).');
  const id = crypto.randomBytes(8).toString('hex');
  const filename = `${id}.webp`;
  await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 84 })
    .toFile(path.join(MISC_DIR, filename));
  return `/uploads/misc/${filename}`;
}

export async function deletePhotoFiles(filename, thumbFilename) {
  const tryDelete = async (relPath) => {
    if (!relPath) return;
    const abs = path.join(__dirname, '..', 'public', relPath.replace(/^\//, ''));
    try {
      await fs.unlink(abs);
    } catch {
      // arquivo pode já não existir; ignora
    }
  };
  await tryDelete(filename);
  await tryDelete(thumbFilename);
}
