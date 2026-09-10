// Leitura do corpo das requisições (JSON e formulários), sem dependências externas.

const MAX_BODY_BYTES = 60 * 1024 * 1024; // 60MB (permite várias fotos em base64 numa única requisição)

// Algumas rotas do admin (só acessíveis já logado — ver server/index.js, o redirecionamento pra
// /admin/login acontece antes de qualquer leitura de corpo) precisam de mais espaço: a página de
// Configurações pode enviar, no mesmo envio, foto de destaque + imagem de compartilhamento + vídeo
// de fundo (até 25MB cada, antes de virar base64) — pedido do usuário em 10/09/2026 pra poder
// arrastar vídeo direto sem precisar de link externo. Importante NÃO usar esse limite maior como
// padrão: o padrão de 60MB continua valendo pra rotas públicas (ex: comentários), sem login, pra
// não abrir uma porta maior de abuso nelas.
export const ADMIN_MEDIA_MAX_BODY_BYTES = 90 * 1024 * 1024; // 90MB

export function readRawBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function parseBody(req, maxBytes = MAX_BODY_BYTES) {
  const contentType = req.headers['content-type'] || '';
  const raw = await readRawBody(req, maxBytes);

  if (contentType.includes('application/json')) {
    if (!raw.length) return {};
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch {
      return {};
    }
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw.toString('utf8'));
    const obj = {};
    for (const [k, v] of params.entries()) {
      if (obj[k] !== undefined) {
        obj[k] = Array.isArray(obj[k]) ? [...obj[k], v] : [obj[k], v];
      } else {
        obj[k] = v;
      }
    }
    return obj;
  }

  return {};
}
