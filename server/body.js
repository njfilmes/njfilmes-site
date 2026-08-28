// Leitura do corpo das requisições (JSON e formulários), sem dependências externas.

const MAX_BODY_BYTES = 60 * 1024 * 1024; // 60MB (permite várias fotos em base64 numa única requisição)

export function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
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

export async function parseBody(req) {
  const contentType = req.headers['content-type'] || '';
  const raw = await readRawBody(req);

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
