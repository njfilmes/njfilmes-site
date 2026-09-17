// Armazenamento das fotos das Entregas na Cloudflare (R2) — pedido do usuário em 17/09/2026
// depois de comparar com o Vercel Blob: o R2 guarda cada arquivo separado (bem diferente de
// "republicar o site inteiro"), então uma foto nova é só mais um arquivo novo, pra sempre, sem
// nenhum limite de armazenamento realista pra esse uso (portfólio/entregas de fotógrafo).
//
// Só é usado se as 4 variáveis de ambiente abaixo estiverem configuradas no Render (o usuário
// mesmo copia da tela "R2" do painel da Cloudflare e cola nas Environment Variables — nunca
// digitadas por mim, mesma regra de sempre):
//   R2_ACCOUNT_ID          — ID da conta Cloudflare (aparece na URL do painel R2)
//   R2_ACCESS_KEY_ID       — chave de acesso gerada em "Manage R2 API Tokens"
//   R2_SECRET_ACCESS_KEY   — chave secreta gerada junto (só aparece uma vez na Cloudflare)
//   R2_BUCKET_NAME         — nome do bucket (ex: "njfilmes-entregas")
//   R2_PUBLIC_URL_BASE     — endereço público do bucket (ex: https://pub-xxxx.r2.dev ou um
//                            domínio próprio conectado a ele), sem barra no final
//
// Sem essas variáveis, este módulo simplesmente não é usado (ver server/upload.js,
// saveDeliveryPhoto) — cai de volta pro Vercel Blob, exatamente como já acontece hoje.
//
// Implementado com "AWS Signature Version 4" (o mesmo padrão de autenticação que a Amazon S3
// usa, e que a Cloudflare adotou de propósito pra R2 ser compatível com qualquer ferramenta S3)
// usando só o node:crypto (sem nenhum pacote novo pra instalar) — é um algoritmo público e
// estável, documentado há anos, então não depende de nenhuma versão de API que possa ter mudado.
import crypto from 'node:crypto';

function useR2() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME &&
      process.env.R2_PUBLIC_URL_BASE
  );
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Monta a assinatura SigV4 e devolve os headers prontos pra requisição. `payloadHash` é o hash
// SHA-256 do corpo (hex) — pra upload (PUT) é o hash do próprio arquivo; pra outras chamadas sem
// corpo, é o hash de uma string vazia.
function signRequest({ method, host, path, region, service, accessKeyId, secretAccessKey, payloadHash, extraHeaders = {} }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');

  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { ...headers, Authorization: authorization };
}

// Envia um buffer pro bucket R2 e devolve a URL pública final. `key` é o "caminho" do arquivo
// dentro do bucket (ex: "entregas/joao-e-maria/fotos/abc123.webp").
export async function putR2Object(buffer, key, contentType = 'image/webp') {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  const publicBase = process.env.R2_PUBLIC_URL_BASE.replace(/\/$/, '');

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const path = `/${bucket}/${key}`;
  const payloadHash = sha256Hex(buffer);

  const headers = signRequest({
    method: 'PUT',
    host,
    path,
    region: 'auto',
    service: 's3',
    accessKeyId,
    secretAccessKey,
    payloadHash,
    extraHeaders: { 'content-type': contentType },
  });

  const res = await fetch(`https://${host}${path}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': contentType },
    body: buffer,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Falha ao enviar pro R2 (status ${res.status}): ${text.slice(0, 300)}`);
  }

  return `${publicBase}/${key}`;
}

export async function deleteR2Object(key) {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const path = `/${bucket}/${key}`;
  const payloadHash = sha256Hex(Buffer.alloc(0));

  const headers = signRequest({
    method: 'DELETE',
    host,
    path,
    region: 'auto',
    service: 's3',
    accessKeyId,
    secretAccessKey,
    payloadHash,
  });

  const res = await fetch(`https://${host}${path}`, { method: 'DELETE', headers });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(`Falha ao apagar do R2 (status ${res.status}): ${text.slice(0, 300)}`);
  }
}

export { useR2 };
