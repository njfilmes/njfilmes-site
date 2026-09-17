// Servidor local de teste, mencionado em server/db.js (comentário no topo do arquivo) — permite
// rodar o site inteiro (painel + público) neste sandbox, com um Postgres de verdade, SEM precisar
// instalar o pacote "pg" do npm (bloqueado nesta rede) e SEM precisar de nenhuma credencial de
// produção. Definindo PG_HTTP_ENDPOINT=http://localhost:<porta-deste-shim> antes de rodar
// `node server/index.js`, o server/db.js passa a mandar cada consulta pra cá em vez de usar "pg"
// diretamente; este script então executa a consulta de verdade contra um Postgres local (o
// `psql` já vem instalado no sistema, então não precisa baixar nada) e devolve o resultado no
// mesmo formato que server/db.js espera.
//
// IMPORTANTE: isso é só uma muleta de teste local, criada nesta sessão pra validar a aba
// "Entregas" sem tocar no /admin de produção nem digitar nenhuma senha real. Não precisa ir pro
// GitHub junto com o resto — é só uma ferramenta de desenvolvimento.
//
// Como rodar (feito nesta sessão, documentado aqui pra referência futura):
//   1. sudo service postgresql start
//   2. sudo -u postgres psql -c "CREATE USER njtest WITH PASSWORD 'njtest' SUPERUSER;"
//   3. sudo -u postgres psql -c "CREATE DATABASE njtest OWNER njtest;"
//   4. node scripts/local-pg-shim.mjs &
//   5. PG_HTTP_ENDPOINT=http://localhost:5487 DATABASE_URL=postgres://njtest:njtest@localhost/njtest PORT=3000 node server/index.js

import http from 'node:http';
import { execFile } from 'node:child_process';

const SHIM_PORT = process.env.SHIM_PORT || 5487;
const PSQL_ARGS_BASE = ['-U', 'njtest', '-d', 'njtest', '-h', '127.0.0.1', '-v', 'ON_ERROR_STOP=1', '-X', '-q', '--csv'];

// Colunas conhecidas do schema (server/db.js) que são inteiras — o resultado de "psql --csv"
// devolve tudo como texto (sem informação de tipo), então sem isso um campo tipo "is_cover"
// viria como a STRING "0", que em JS é "truthy" (o painel mostraria sempre como capa, por
// exemplo). Convertendo só essas colunas conhecidas pra Number, o resto (slugs, telefones,
// video_id etc, que podem legitimamente ser só dígitos) continua como texto, igual o driver
// real faria.
const INT_COLUMNS = new Set([
  'id', 'admin_id', 'category_id', 'project_id', 'case_id', 'photo_id', 'video_id_num',
  'is_cover', 'published', 'featured', 'hide_from_recent', 'hide_gallery', 'sort_order',
  'views', 'likes', 'width', 'height', 'selected', 'photo_limit', 'c', 'm', 'n',
]);

function pgEscapeString(value) {
  // Dollar-quoting evita ter que escapar aspas/backslashes manualmente — muito mais simples e
  // seguro de acertar do que escapar aspas na mão. Só precisa garantir que a própria string não
  // contenha a tag escolhida (extremamente improvável nos dados deste app).
  let tag = 'njq';
  let i = 0;
  while (value.includes(`$${tag}$`)) {
    tag = `njq${i}`;
    i += 1;
  }
  return `$${tag}$${value}$${tag}$`;
}

function toSqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return pgEscapeString(String(value));
}

function interpolate(sql, params) {
  return sql.replace(/\$(\d+)/g, (full, numStr) => {
    const idx = Number(numStr) - 1;
    if (idx < 0 || idx >= params.length) return full;
    return toSqlLiteral(params[idx]);
  });
}

// Parser de CSV simples e correto o suficiente pro formato que o próprio `psql --csv` gera
// (RFC4180: campos com vírgula/aspas/quebra de linha vêm entre aspas duplas, aspas dentro do
// campo viram aspas duplicadas). Devolve um array de linhas, cada linha um array de { value,
// quoted } (precisamos saber se veio entre aspas pra diferenciar string vazia de NULL).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  function pushField() {
    row.push({ value: field, quoted });
    field = '';
    quoted = false;
  }
  function pushRow() {
    pushField();
    rows.push(row);
    row = [];
  }
  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { inQuotes = true; quoted = true; i += 1; continue; }
    if (ch === ',') { pushField(); i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') { pushRow(); i += 1; continue; }
    field += ch; i += 1;
  }
  // última linha (sem \n final)
  if (field !== '' || row.length) pushRow();
  return rows.filter((r) => !(r.length === 1 && r[0].value === '' && !r[0].quoted));
}

function rowsToObjects(csvText) {
  const trimmed = csvText.replace(/\n+$/, '');
  if (!trimmed) return [];
  const table = parseCsv(trimmed);
  if (!table.length) return [];
  const headers = table[0].map((c) => c.value);
  return table.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((h, idx) => {
      const cell = cells[idx];
      if (!cell || (!cell.quoted && cell.value === '')) {
        obj[h] = null;
        return;
      }
      if (INT_COLUMNS.has(h) && /^-?\d+$/.test(cell.value)) {
        obj[h] = Number(cell.value);
      } else {
        obj[h] = cell.value;
      }
    });
    return obj;
  });
}

function runPsql(sql) {
  return new Promise((resolve, reject) => {
    execFile('psql', [...PSQL_ARGS_BASE, '-c', sql], { maxBuffer: 50 * 1024 * 1024, env: { ...process.env, PGPASSWORD: 'njtest' } }, (err, stdout, stderr) => {
      if (err) {
        const message = (stderr || err.message || 'Erro desconhecido no psql').trim();
        const wrapped = new Error(message);
        wrapped.code = 'PSQL_ERROR';
        return reject(wrapped);
      }
      resolve(stdout);
    });
  });
}

async function runOne(query, params = []) {
  const finalSql = interpolate(query, params);
  const stdout = await runPsql(finalSql);
  const rows = rowsToObjects(stdout);
  return { rows, rowCount: rows.length, command: null, fields: [] };
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', async () => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
      const parsed = JSON.parse(body || '{}');
      if (Array.isArray(parsed.queries)) {
        const results = [];
        for (const q of parsed.queries) {
          results.push(await runOne(q.query, q.params || []));
        }
        return res.end(JSON.stringify({ results }));
      }
      const result = await runOne(parsed.query, parsed.params || []);
      return res.end(JSON.stringify(result));
    } catch (err) {
      console.error('[local-pg-shim] erro:', err.message);
      res.statusCode = 500;
      res.end(JSON.stringify({ message: err.message, code: err.code || 'SHIM_ERROR' }));
    }
  });
});

server.listen(SHIM_PORT, () => {
  console.log(`[local-pg-shim] rodando em http://localhost:${SHIM_PORT} (repassando pro Postgres local via psql)`);
});
