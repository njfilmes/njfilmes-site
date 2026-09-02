// Consultas reutilizáveis ao banco de dados (Postgres via server/db.js). Todas as funções agora
// são assíncronas (retornam Promise) — quem chama precisa usar `await`.
import { query, queryRows, queryOne } from './db.js';

export async function getSettings() {
  return queryOne('SELECT * FROM settings WHERE id = 1');
}

export async function updateSettings(fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  await query(`UPDATE settings SET ${set} WHERE id = 1`, keys.map((k) => fields[k]));
}

export async function getBio() {
  return queryOne('SELECT * FROM bio WHERE id = 1');
}

export async function updateBio(fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  await query(`UPDATE bio SET ${set} WHERE id = 1`, keys.map((k) => fields[k]));
}

// ---------- Fotos da página Sobre (galeria que fica passando, além da foto de perfil) ----------
export async function listBioPhotos() {
  return queryRows('SELECT * FROM bio_photos ORDER BY sort_order ASC, id ASC');
}
export async function addBioPhoto(filename) {
  const maxRow = await queryOne('SELECT COALESCE(MAX(sort_order),0) as m FROM bio_photos');
  const row = await queryOne('INSERT INTO bio_photos (filename, sort_order) VALUES ($1, $2) RETURNING id', [
    filename,
    Number(maxRow.m) + 1,
  ]);
  return row.id;
}
export async function deleteBioPhoto(id) {
  await query('DELETE FROM bio_photos WHERE id = $1', [id]);
}

export async function listCategories() {
  return queryRows('SELECT * FROM categories ORDER BY sort_order ASC, name ASC');
}
export async function getCategoryBySlug(slug) {
  return queryOne('SELECT * FROM categories WHERE slug = $1', [slug]);
}
export async function getCategory(id) {
  return queryOne('SELECT * FROM categories WHERE id = $1', [id]);
}
export async function createCategory({ name, slug, sort_order = 0 }) {
  const row = await queryOne('INSERT INTO categories (name, slug, sort_order) VALUES ($1, $2, $3) RETURNING id', [
    name,
    slug,
    sort_order,
  ]);
  return row.id;
}
export async function updateCategory(id, { name, slug, sort_order }) {
  await query('UPDATE categories SET name = $1, slug = $2, sort_order = $3 WHERE id = $4', [name, slug, sort_order, id]);
}
export async function deleteCategory(id) {
  await query('UPDATE projects SET category_id = NULL WHERE category_id = $1', [id]);
  await query('DELETE FROM categories WHERE id = $1', [id]);
}

export async function listServices({ onlyPublished = false } = {}) {
  const sql = `SELECT * FROM services ${onlyPublished ? 'WHERE published = 1' : ''} ORDER BY sort_order ASC, id ASC`;
  return queryRows(sql);
}
export async function getService(id) {
  return queryOne('SELECT * FROM services WHERE id = $1', [id]);
}
export async function createService(data) {
  const row = await queryOne(
    'INSERT INTO services (title, description, image, sort_order, published) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [data.title, data.description || '', data.image || '', data.sort_order || 0, data.published ? 1 : 0]
  );
  return row.id;
}
export async function updateService(id, data) {
  await query('UPDATE services SET title=$1, description=$2, image=$3, sort_order=$4, published=$5 WHERE id=$6', [
    data.title,
    data.description || '',
    data.image || '',
    data.sort_order || 0,
    data.published ? 1 : 0,
    id,
  ]);
}
export async function deleteService(id) {
  await query('DELETE FROM services WHERE id = $1', [id]);
}

export async function listLinks() {
  return queryRows('SELECT * FROM links ORDER BY sort_order ASC, id ASC');
}
export async function createLink({ name, url, sort_order = 0 }) {
  const row = await queryOne('INSERT INTO links (name, url, sort_order) VALUES ($1, $2, $3) RETURNING id', [
    name,
    url,
    sort_order,
  ]);
  return row.id;
}
export async function updateLink(id, { name, url, sort_order }) {
  await query('UPDATE links SET name=$1, url=$2, sort_order=$3 WHERE id=$4', [name, url, sort_order, id]);
}
export async function deleteLink(id) {
  await query('DELETE FROM links WHERE id = $1', [id]);
}

// ---------- Projetos ----------

async function attachRelations(project) {
  if (!project) return project;
  project.videos = await queryRows('SELECT * FROM project_videos WHERE project_id = $1 ORDER BY sort_order ASC, id ASC', [
    project.id,
  ]);
  project.photos = await queryRows('SELECT * FROM photos WHERE project_id = $1 ORDER BY sort_order ASC, id ASC', [
    project.id,
  ]);
  if (project.category_id) {
    project.category = await getCategory(project.category_id);
  }
  return project;
}

export async function listProjects({ onlyPublished = false, categoryId = null, featuredOnly = false, limit = null } = {}) {
  const clauses = [];
  const params = [];
  if (onlyPublished) clauses.push('p.published = 1');
  if (categoryId) {
    params.push(categoryId);
    clauses.push(`p.category_id = $${params.length}`);
  }
  if (featuredOnly) clauses.push('p.featured = 1');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const lim = limit ? `LIMIT ${Number(limit)}` : '';
  return queryRows(
    `SELECT p.*, c.name as category_name, c.slug as category_slug
     FROM projects p LEFT JOIN categories c ON c.id = p.category_id
     ${where}
     ORDER BY p.sort_order ASC, p.created_at DESC ${lim}`,
    params
  );
}

export async function countProjects({ onlyPublished = false } = {}) {
  const sql = onlyPublished ? 'SELECT COUNT(*) as c FROM projects WHERE published = 1' : 'SELECT COUNT(*) as c FROM projects';
  const row = await queryOne(sql);
  return Number(row.c);
}
export async function countPhotos() {
  const row = await queryOne('SELECT COUNT(*) as c FROM photos');
  return Number(row.c);
}
export async function countCategories() {
  const row = await queryOne('SELECT COUNT(*) as c FROM categories');
  return Number(row.c);
}

export async function getProjectBySlug(slug) {
  const project = await queryOne(
    `SELECT p.*, c.name as category_name, c.slug as category_slug
     FROM projects p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.slug = $1`,
    [slug]
  );
  return attachRelations(project);
}

export async function getProject(id) {
  const project = await queryOne('SELECT * FROM projects WHERE id = $1', [id]);
  return attachRelations(project);
}

// Soma 1 na visualização do projeto (chamado via /api/visualizar toda vez que a página é aberta —
// a página em si agora é estática, então essa contagem acontece por uma chamada do navegador, não
// mais no momento de renderizar a página no servidor).
export async function incrementProjectViews(id) {
  const row = await queryOne('UPDATE projects SET views = views + 1 WHERE id = $1 RETURNING views', [id]);
  return row ? row.views : null;
}

// Soma 1 na curtida do projeto e devolve o total atualizado (usado pelo botão de curtir no site).
export async function incrementProjectLikes(id) {
  const row = await queryOne('UPDATE projects SET likes = likes + 1 WHERE id = $1 RETURNING likes', [id]);
  return row ? row.likes : null;
}

export async function createProject(data) {
  const now = new Date().toISOString();
  const row = await queryOne(
    `INSERT INTO projects (title, slug, category_id, description, project_date, location, cover_photo, credits, additional_info, published, featured, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
    [
      data.title,
      data.slug,
      data.category_id || null,
      data.description || '',
      data.project_date || '',
      data.location || '',
      data.cover_photo || '',
      data.credits || '',
      data.additional_info || '',
      data.published ? 1 : 0,
      data.featured ? 1 : 0,
      data.sort_order || 0,
      now,
      now,
    ]
  );
  return row.id;
}

export async function updateProject(id, data) {
  await query(
    `UPDATE projects SET title=$1, slug=$2, category_id=$3, description=$4, project_date=$5, location=$6, cover_photo=$7, credits=$8, additional_info=$9, published=$10, featured=$11, sort_order=$12, updated_at=$13
     WHERE id=$14`,
    [
      data.title,
      data.slug,
      data.category_id || null,
      data.description || '',
      data.project_date || '',
      data.location || '',
      data.cover_photo || '',
      data.credits || '',
      data.additional_info || '',
      data.published ? 1 : 0,
      data.featured ? 1 : 0,
      data.sort_order || 0,
      new Date().toISOString(),
      id,
    ]
  );
}

export async function deleteProject(id) {
  await query('DELETE FROM projects WHERE id = $1', [id]);
}

export async function listAllProjectsForAdmin() {
  return queryRows(
    `SELECT p.*, c.name as category_name
     FROM projects p LEFT JOIN categories c ON c.id = p.category_id
     ORDER BY p.created_at DESC`
  );
}

// ---------- Vídeos do projeto ----------
export async function addProjectVideo(projectId, { provider, video_id, url, title, sort_order = 0 }) {
  const row = await queryOne(
    'INSERT INTO project_videos (project_id, provider, video_id, url, title, sort_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [projectId, provider, video_id || '', url, title || '', sort_order]
  );
  return row.id;
}
export async function deleteProjectVideo(id) {
  await query('DELETE FROM project_videos WHERE id = $1', [id]);
}
export async function getProjectVideo(id) {
  return queryOne('SELECT * FROM project_videos WHERE id = $1', [id]);
}

// ---------- Fotos do projeto ----------
export async function addPhoto(projectId, { filename, thumbFilename, caption = '', sort_order = 0, is_cover = 0 }) {
  const row = await queryOne(
    'INSERT INTO photos (project_id, filename, thumb_filename, caption, is_cover, sort_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [projectId, filename, thumbFilename, caption, is_cover, sort_order]
  );
  return row.id;
}
export async function getPhoto(id) {
  return queryOne('SELECT * FROM photos WHERE id = $1', [id]);
}
export async function deletePhoto(id) {
  await query('DELETE FROM photos WHERE id = $1', [id]);
}
export async function setPhotoCaption(id, caption) {
  await query('UPDATE photos SET caption = $1 WHERE id = $2', [caption, id]);
}
export async function setPhotoOrder(id, sort_order) {
  await query('UPDATE photos SET sort_order = $1 WHERE id = $2', [sort_order, id]);
}
// ---------- Marcas (clientes) ----------
export async function listBrands() {
  return queryRows('SELECT * FROM brands ORDER BY sort_order ASC, id ASC');
}
export async function getBrand(id) {
  return queryOne('SELECT * FROM brands WHERE id = $1', [id]);
}
export async function createBrand({ name, logo, url = '', sort_order = 0 }) {
  const row = await queryOne('INSERT INTO brands (name, logo, url, sort_order) VALUES ($1, $2, $3, $4) RETURNING id', [
    name,
    logo,
    url,
    sort_order,
  ]);
  return row.id;
}
export async function updateBrand(id, { name, logo, url, sort_order }) {
  await query('UPDATE brands SET name=$1, logo=$2, url=$3, sort_order=$4 WHERE id=$5', [name, logo, url || '', sort_order, id]);
}
export async function deleteBrand(id) {
  await query('DELETE FROM brands WHERE id = $1', [id]);
}

// ---------- Pessoas (quem já trabalhou com a NJFILMES) ----------
export async function listPeople() {
  return queryRows('SELECT * FROM people ORDER BY sort_order ASC, id ASC');
}
export async function getPerson(id) {
  return queryOne('SELECT * FROM people WHERE id = $1', [id]);
}
export async function createPerson({ name, role = '', photo, sort_order = 0 }) {
  const row = await queryOne('INSERT INTO people (name, role, photo, sort_order) VALUES ($1, $2, $3, $4) RETURNING id', [
    name,
    role,
    photo,
    sort_order,
  ]);
  return row.id;
}
export async function updatePerson(id, { name, role, photo, sort_order }) {
  await query('UPDATE people SET name=$1, role=$2, photo=$3, sort_order=$4 WHERE id=$5', [name, role || '', photo, sort_order, id]);
}
export async function deletePerson(id) {
  await query('DELETE FROM people WHERE id = $1', [id]);
}

export async function setPhotoAsCover(projectId, photoId) {
  await query('UPDATE photos SET is_cover = 0 WHERE project_id = $1', [projectId]);
  await query('UPDATE photos SET is_cover = 1 WHERE id = $1', [photoId]);
  const photo = await getPhoto(photoId);
  if (photo) await query('UPDATE projects SET cover_photo = $1 WHERE id = $2', [photo.filename, projectId]);
}

// ---------- Depoimentos (feedback de clientes em vídeo) ----------
export async function listTestimonials() {
  return queryRows('SELECT * FROM testimonials ORDER BY sort_order ASC, id ASC');
}
export async function getTestimonial(id) {
  return queryOne('SELECT * FROM testimonials WHERE id = $1', [id]);
}
export async function createTestimonial({ client_name, role = '', provider, video_id = '', video_url, sort_order = 0 }) {
  const row = await queryOne(
    'INSERT INTO testimonials (client_name, role, provider, video_id, video_url, sort_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [client_name, role || '', provider, video_id || '', video_url, sort_order]
  );
  return row.id;
}
export async function updateTestimonial(id, { client_name, role, provider, video_id, video_url, sort_order }) {
  await query(
    'UPDATE testimonials SET client_name=$1, role=$2, provider=$3, video_id=$4, video_url=$5, sort_order=$6 WHERE id=$7',
    [client_name, role || '', provider, video_id || '', video_url, sort_order, id]
  );
}
export async function deleteTestimonial(id) {
  await query('DELETE FROM testimonials WHERE id = $1', [id]);
}
