// Banco de dados real da NJFILMES — Postgres.
//
// Em produção, usamos o driver oficial "pg" (node-postgres) com uma pool de conexões — funciona
// com qualquer Postgres de verdade: Postgres gerenciado do Render, Neon, ou qualquer outro que dê
// uma connection string padrão (postgres://usuario:senha@host/banco).
//
// Em desenvolvimento local dentro do sandbox (onde não é possível instalar o pacote "pg"), definir
// a variável PG_HTTP_ENDPOINT faz o código usar um caminho alternativo por HTTP (fetch nativo do
// Node) contra um pequeno servidor local que imita esse protocolo (ver scripts/local-pg-shim.mjs).
// Isso é só uma muleta de teste — em produção essa variável não deve ser definida, e o código usa
// "pg" normalmente.
//
// Variáveis de ambiente esperadas:
//   DATABASE_URL      — string de conexão completa do Postgres (postgres://usuario:senha@host/banco)
//   PG_HTTP_ENDPOINT  — (opcional, só para desenvolvimento local) força o caminho HTTP de teste

const DATABASE_URL = process.env.DATABASE_URL || '';
if (!DATABASE_URL) {
    throw new Error(
          'DATABASE_URL não configurada. Defina a variável de ambiente com a connection string do Postgres.'
        );
}

const HTTP_ENDPOINT = process.env.PG_HTTP_ENDPOINT || null;

// ---------- Caminho de teste local (HTTP, sem depender do pacote "pg") ----------
async function httpQuery(text, params = []) {
    let res;
    try {
          res = await fetch(HTTP_ENDPOINT, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': DATABASE_URL },
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

async function httpBatch(queries) {
    let res;
    try {
          res = await fetch(HTTP_ENDPOINT, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': DATABASE_URL },
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

// ---------- Caminho real de produção (pacote "pg") ----------
let pgPoolPromise = null;
async function getPool() {
    if (!pgPoolPromise) {
          pgPoolPromise = (async () => {
                  const { default: pg } = await import('pg');
                  const needsSsl = !/localhost|127\.0\.0\.1/.test(DATABASE_URL);
                  return new pg.Pool({
                            connectionString: DATABASE_URL,
                            ssl: needsSsl ? { rejectUnauthorized: false } : false,
                            max: 5,
                  });
          })();
    }
    return pgPoolPromise;
}

async function pgQuery(text, params = []) {
    const pool = await getPool();
    try {
          const result = await pool.query(text, params);
          return { rows: result.rows, rowCount: result.rowCount, command: result.command, fields: result.fields };
    } catch (err) {
          err.sql = text;
          throw err;
    }
}

async function pgBatch(queries) {
    const pool = await getPool();
    const client = await pool.connect();
    const results = [];
    try {
          await client.query('BEGIN');
          for (const q of queries) {
                  const result = await client.query(q.text, q.params || []);
                  results.push({ rows: result.rows, rowCount: result.rowCount, command: result.command, fields: result.fields });
          }
          await client.query('COMMIT');
          return results;
    } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
    } finally {
          client.release();
    }
}

// ---------- API pública (igual nos dois caminhos — quem chama nunca precisa saber a diferença) ----------

// Executa uma única consulta parametrizada ($1, $2, ...) e devolve { rows, rowCount, command, fields }.
export async function query(text, params = []) {
    return HTTP_ENDPOINT ? httpQuery(text, params) : pgQuery(text, params);
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
    return HTTP_ENDPOINT ? httpBatch(queries) : pgBatch(queries);
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
                                                                                                                  contact_email TEXT DEFAULT '',
  contact_headline TEXT DEFAULT 'Vamos conversar sobre seu projeto',
  contact_budget_title TEXT DEFAULT 'Orçamento rápido',
  contact_budget_text TEXT DEFAULT 'A forma mais rápida de falar com a NJFILMES é pelo WhatsApp — conte um pouco sobre o seu evento, data e local que retornamos com uma proposta.',
  contact_whatsapp_button_text TEXT DEFAULT 'Falar no WhatsApp',
  contact_channels_title TEXT DEFAULT 'Outros canais',
  hero_photo TEXT DEFAULT ''
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
                                                            cta_text TEXT DEFAULT 'Vamos criar algo juntos?',
                                                                  gallery_title TEXT DEFAULT 'No set com a NJFILMES',
                                                                        trajectory_title TEXT DEFAULT 'Uma jornada pela imagem'
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

  // Menu principal do site (pedido em 03/09/2026): antes os itens "Home/Portfólio/Sobre/
  // Serviços/Contato" eram fixos no código -- agora ficam nessa tabela pra dar pra
  // adicionar, remover, renomear ou reordenar pelo painel administrativo, igual já
  // acontece com "Links externos" e "Categorias". O item cuja url for exatamente
  // "/portfolio" continua ganhando o submenu de categorias automaticamente (não muda).
  await query(`
      CREATE TABLE IF NOT EXISTS nav_links (
            id SERIAL PRIMARY KEY,
                  label TEXT NOT NULL,
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
                                                                                    hide_from_recent INTEGER NOT NULL DEFAULT 0,
                                                                                    hide_gallery INTEGER NOT NULL DEFAULT 0,
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

  // Galeria "Bastidores" da página Sobre (faixa de fotos rolando sozinha). Antes eram 11 arquivos
  // fixos em /img/bio/ que só eu conseguia trocar mexendo no código — pedido do usuário em
  // 02/09/2026 pra poder trocar essas fotos direto pelo painel, igual às outras galerias.
  await query(`
      CREATE TABLE IF NOT EXISTS bio_gallery_photos (
            id SERIAL PRIMARY KEY,
                  filename TEXT NOT NULL,
                        sort_order INTEGER NOT NULL DEFAULT 0,
                              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                                  );
                                    `);

  // Fotos de destaque da Home que ficam passando (crossfade) na primeira tela do site, além da
  // foto única de sempre (settings.hero_photo) — pedido do usuário em 03/09/2026 pra poder
  // colocar mais fotos e escolher quais entram no rodízio, editável pelo painel (Configurações).
  await query(`
      CREATE TABLE IF NOT EXISTS hero_photos (
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

  // Comentários dos visitantes nas páginas de projeto (fotos e vídeos, o mesmo mural pra
  // qualquer tipo de projeto — pedido do usuário em 03/09/2026). admin_reply guarda uma
  // resposta pública opcional escrita pelo painel (/admin/comentarios); fica vazia até o
  // administrador responder. Excluir um comentário aqui é definitivo (igual excluir uma foto).
  await query(`
      CREATE TABLE IF NOT EXISTS comments (
            id SERIAL PRIMARY KEY,
                  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                        author_name TEXT NOT NULL,
                              content TEXT NOT NULL,
                                    admin_reply TEXT DEFAULT '',
                                          admin_reply_at TIMESTAMPTZ,
                                                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                                                    );
                                                      `);
  await query('CREATE INDEX IF NOT EXISTS idx_comments_project ON comments(project_id);');

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
    // Textos da página Contato (título, "Orçamento rápido", texto do botão do WhatsApp, "Outros
    // canais") que antes eram fixos no código e o cliente não conseguia editar. Adicionado em
    // 02/09/2026 numa rodada de "deixar tudo editável".
    if (!settingsCols.includes('contact_headline')) {
          await query("ALTER TABLE settings ADD COLUMN contact_headline TEXT DEFAULT 'Vamos conversar sobre seu projeto'");
    }
    if (!settingsCols.includes('contact_budget_title')) {
          await query("ALTER TABLE settings ADD COLUMN contact_budget_title TEXT DEFAULT 'Orçamento rápido'");
    }
    if (!settingsCols.includes('contact_budget_text')) {
          await query("ALTER TABLE settings ADD COLUMN contact_budget_text TEXT DEFAULT 'A forma mais rápida de falar com a NJFILMES é pelo WhatsApp — conte um pouco sobre o seu evento, data e local que retornamos com uma proposta.'");
    }
    if (!settingsCols.includes('contact_whatsapp_button_text')) {
          await query("ALTER TABLE settings ADD COLUMN contact_whatsapp_button_text TEXT DEFAULT 'Falar no WhatsApp'");
    }
    if (!settingsCols.includes('contact_channels_title')) {
          await query("ALTER TABLE settings ADD COLUMN contact_channels_title TEXT DEFAULT 'Outros canais'");
    }
    // 03/09/2026: permite trocar a foto de destaque da Home (o usuario segurando a
    // camera) pelo painel, em vez de ser um arquivo fixo no codigo. Se ficar vazia,
    // o site continua usando a imagem padrao (public/img/hero-poster.webp).
    if (!settingsCols.includes('hero_photo')) {
          await query("ALTER TABLE settings ADD COLUMN hero_photo TEXT DEFAULT ''");
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
    // 03/09/2026: permite ocultar um projeto especifico da vitrine "Portfolio selecionado" da Home,
    // sem precisar despublicar ele (essa vitrine antes so respeitava featured + mais recentes).
    if (!projectCols.includes('hide_from_recent')) {
          await query('ALTER TABLE projects ADD COLUMN hide_from_recent INTEGER NOT NULL DEFAULT 0');
    }
    // 03/09/2026: permite esconder so a secao "Galeria" da pagina publica do projeto, sem afetar
    // a foto de capa (que continua sendo usada normalmente nos cards da Home/Portfolio). Pedido do
    // usuario depois de um caso onde a unica foto de um projeto era ao mesmo tempo a capa e a unica
    // foto da galeria — ele queria só a galeria escondida, não a foto excluída.
    if (!projectCols.includes('hide_gallery')) {
          await query('ALTER TABLE projects ADD COLUMN hide_gallery INTEGER NOT NULL DEFAULT 0');
    }

  const bioCols = (await queryRows("SELECT column_name FROM information_schema.columns WHERE table_name = 'bio'")).map(
        (c) => c.column_name
      );
    if (!bioCols.includes('gallery_title')) {
          await query("ALTER TABLE bio ADD COLUMN gallery_title TEXT DEFAULT 'No set com a NJFILMES'");
    }
    if (!bioCols.includes('trajectory_title')) {
          await query("ALTER TABLE bio ADD COLUMN trajectory_title TEXT DEFAULT 'Uma jornada pela imagem'");
    }

  // Garante que exista sempre exatamente uma linha de settings e de bio (singletons).
  await query('INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;');
    await query('INSERT INTO bio (id) VALUES (1) ON CONFLICT (id) DO NOTHING;');

  // Migra as 11 fotos de bastidores que antes eram arquivos fixos em /img/bio/ para a tabela
  // editável — só na primeira vez (se a tabela ainda estiver vazia), pra ninguém perder as fotos
  // que já estavam no ar quando essa versão for publicada.
  const galleryCountRow = await queryOne('SELECT COUNT(*)::int as n FROM bio_gallery_photos');
    if (galleryCountRow.n === 0) {
          for (let i = 1; i <= 11; i += 1) {
                  await query('INSERT INTO bio_gallery_photos (filename, sort_order) VALUES ($1, $2)', [`/img/bio/bio-${i}.jpg`, i]);
          }
    }

  // Semeia o menu principal com os 5 itens que já existiam fixos no código -- só na
  // primeira vez (tabela vazia), pra ninguém que já tinha o site no ar perder um item
  // do menu quando essa versão for publicada.
  const navLinksCountRow = await queryOne('SELECT COUNT(*)::int as n FROM nav_links');
  if (navLinksCountRow.n === 0) {
    const defaultNavLinks = [
      ['Home', '/'],
      ['Portfólio', '/portfolio'],
      ['Sobre', '/sobre'],
      ['Serviços', '/servicos'],
      ['Contato', '/contato'],
    ];
    for (let i = 0; i < defaultNavLinks.length; i += 1) {
      await query('INSERT INTO nav_links (label, url, sort_order) VALUES ($1, $2, $3)', [defaultNavLinks[i][0], defaultNavLinks[i][1], i]);
    }
  }
}

export function nowIso() {
    return new Date().toISOString();
}
