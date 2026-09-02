// Banco de dados real da NJFILMES — Postgres (Neon) via a interface "SQL sobre HTTP" do Neon.
// Não usamos nenhum pacote externo (tipo "pg"): fazemos uma requisição HTTP simples (fetch, nativo
// do Node) pra cada consulta. Isso funciona porque o Neon expõe um endpoint HTTPS (https://<host>/sql)
// que recebe { query, params } em JSON e devolve { rows, rowCount, command, fields } em JSON — o
// proxy do Neon cuida da parte de protocolo binário do Postgres e autenticação por trás disso.
//
// Variáveis de ambiente esperadas:
//   DATABASE_URL        — string de conexão completa do Postgres (postgres://usuario:senha@host/banco)
//   PG_HTTP_ENDPOINT     — (opcional) força um endpoint HTTP específico. Útil só em desenvolvimento local,
//                          onde não existe um proxy Neon de verdade — aponta pro shim local (ver
//                          scripts/local-pg-shim.mjs). Em produção, não precisa setar: é derivado
//                          automaticamente do host dentro de DATABASE_URL (https://<host>/sql).

const DATABASE_URL = process.env.DATABASE_URL || '';
if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL não configurada. Defina a variável de ambiente com a connection string do Postgres (Neon).'
  );
}

function deriveHttpEndpoint(connectionString) {
  if (process.env.PG_HTTP_ENDPOINT) return process.env.PG_HTTP_ENDPOINT;
  try {
    const u = new URL(connectionString);
    return `https://${u.hostname}/sql`;
  } catch {
    throw new Error('DATABASE_URL inválida — não foi possível extrair o host pra montar o endpoint HTTP.');
  }
}

const HTTP_ENDPOINT = deriveHttpEndpoint(DATABASE_URL);

// Executa uma única consulta parametrizada ($1, $2, ...) e devolve { rows, rowCount, command, fields }.
export async function query(text, params = []) {
  let res;
  try {
    res = await fetch(HTTP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Neon-Connection-String': DATABASE_URL,
      },
      body: JSON.stringify({ query: text, params }),
    });
  } catch (err) {
    throw new Error(`Falha de rede ao falar com o banco de dados: ${err.message}`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Resposta inesperada do banco de dados (status ${res.status}).`);
  }

  if (!res.ok) {
    const err = new Error(data.message || `Erro na consulta ao banco de dados (status ${res.status}).`);
    err.code = data.code;
    err.pgError = data;
    err.sql = text;
    throw err;
  }
  return data;
}

// Atalho: devolve só as linhas (array), pra consultas SELECT.
export async function queryRows(text, params = []) {
  const result = await query(text, params);
  return result.rows || [];
}

// Atalho: devolve só a primeira linha (ou null), pra consultas que esperam no máximo 1 resultado.
export async function queryOne(text, params = []) {
  const rows = await queryRows(text, params);
  return rows.length ? rows[0] : null;
}

// Executa várias consultas como uma transação atômica (tudo ou nada). Útil pra operações que
// mexem em mais de uma linha/tabela ao mesmo tempo (ex.: trocar a ordem de dois itens).
export async function batch(queries) {
  let res;
  try {
    res = await fetch(HTTP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Neon-Connection-String': DATABASE_URL,
      },
      body: JSON.stringify({ queries: queries.map((q) => ({ query: q.text, params: q.params || [] })) }),
    });
  } catch (err) {
    throw new Error(`Falha de rede ao falar com o banco de dados: ${err.message}`);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Resposta inesperada do banco de dados (status ${res.status}).`);
  }
  if (!res.ok) {
    const err = new Error(data.message || `Erro na consulta em lote ao banco de dados (status ${res.status}).`);
    err.code = data.code;
    err.pgError = data;
    throw err;
  }
  return data.results || [];
}

// Cria as tabelas (se não existirem) e aplica migrações defensivas de colunas novas.
export async function initSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      site_name TEXT DEFAULT 'NJFILMES',
      tagline TEXT DEFAULT 'Produção audiovisual cinematográfica',
      whatsapp_number TEXT DEFAULT '',
      whatsapp_message TEXT DEFAULT 'Olá! Vim pelo site e gostaria de solicitar um orçamento com a NJFILMES.',
      instagram_url TEXT DEFAULT '',
      youtube_url TEXT DEFAULT '',
      vimeo_url TEXT DEFAULT '',
      tiktok_url TEXT DEFAULT '',
      facebook_url TEXT DEFAULT '',
      hero_video_url TEXT DEFAULT '',
      hero_headline TEXT DEFAULT 'Histórias que merecem ser eternizadas',
      hero_subheadline TEXT DEFAULT 'Produção audiovisual, fotografia e drone para eventos, casamentos, artistas e marcas.',
      meta_title TEXT DEFAULT 'NJFILMES — Produção Audiovisual',
      meta_description TEXT DEFAULT 'NJFILMES: produção de vídeos, fotografia, cobertura de eventos, casamentos, videoclipes e filmagens com drone em Salvador, BA.',
      og_image TEXT DEFAULT '',
      footer_text TEXT DEFAULT 'NJFILMES — Produção Audiovisual. Salvador, BA.',
      contact_email TEXT DEFAULT ''
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS bio (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT DEFAULT '',
      professional_title TEXT DEFAULT '',
      biography TEXT DEFAULT '',
      trajectory TEXT DEFAULT '',
      specialties TEXT DEFAULT '',
      equipment TEXT DEFAULT '',
      profile_photo TEXT DEFAULT '',
      cta_text TEXT DEFAULT 'Vamos criar algo juntos?'
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      image TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      published INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS links (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      description TEXT DEFAULT '',
      project_date TEXT DEFAULT '',
      location TEXT DEFAULT '',
      cover_photo TEXT DEFAULT '',
      credits TEXT DEFAULT '',
      additional_info TEXT DEFAULT '',
      published INTEGER NOT NULL DEFAULT 0,
      featured INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      views INTEGER NOT NULL DEFAULT 0,
      likes INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS project_videos (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      video_id TEXT DEFAULT '',
      url TEXT NOT NULL,
      title TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS photos (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      thumb_filename TEXT NOT NULL,
      caption TEXT DEFAULT '',
      is_cover INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS brands (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      logo TEXT NOT NULL,
      url TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS people (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT DEFAULT '',
      photo TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Fotos da página Sobre que ficam passando (crossfade) ao lado da biografia — além da foto de
  // perfil, o usuário pode enviar quantas quiser pelo painel (pedido em 30/08/2026).
  await query(`
    CREATE TABLE IF NOT EXISTS bio_photos (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Depoimentos em vídeo de clientes, exibidos numa faixa de rolagem manual na Home.
  await query(`
    CREATE TABLE IF NOT EXISTS testimonials (
      id SERIAL PRIMARY KEY,
      client_name TEXT NOT NULL,
      role TEXT DEFAULT '',
      provider TEXT NOT NULL,
      video_id TEXT DEFAULT '',
      video_url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query('CREATE INDEX IF NOT EXISTS idx_projects_category ON projects(category_id);');
  await query('CREATE INDEX IF NOT EXISTS idx_photos_project ON photos(project_id);');
  await query('CREATE INDEX IF NOT EXISTS idx_videos_project ON project_videos(project_id);');

  // Migrações defensivas: bancos já existentes (criados antes destes campos existirem) não ganham
  // as colunas novas automaticamente com CREATE TABLE IF NOT EXISTS, então checamos e adicionamos
  // aqui se faltarem.
  const settingsCols = (await queryRows("SELECT column_name FROM information_schema.columns WHERE table_name = 'settings'")).map(
    (c) => c.column_name
  );
  if (!settingsCols.includes('contact_email')) {
    await query("ALTER TABLE settings ADD COLUMN contact_email TEXT DEFAULT ''");
  }

  const projectCols = (await queryRows("SELECT column_name FROM information_schema.columns WHERE table_name = 'projects'")).map(
    (c) => c.column_name
  );
  if (!projectCols.includes('views')) {
    await query('ALTER TABLE projects ADD COLUMN views INTEGER NOT NULL DEFAULT 0');
  }
  if (!projectCols.includes('likes')) {
    await query('ALTER TABLE projects ADD COLUMN likes INTEGER NOT NULL DEFAULT 0');
  }

  // Garante que exista sempre exatamente uma linha de settings e de bio (singletons).
  await query('INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;');
  await query('INSERT INTO bio (id) VALUES (1) ON CONFLICT (id) DO NOTHING;');
}

export function nowIso() {
  return new Date().toISOString();
}
