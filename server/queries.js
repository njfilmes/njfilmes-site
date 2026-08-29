// Consultas reutilizáveis ao banco de dados.
import { db } from './db.js';

export function getSettings() {
  return db.prepare('SELECT * FROM settings WHERE id = 1').get();
}

export function updateSettings(fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE settings SET ${set} WHERE id = 1`).run(...keys.map((k) => fields[k]));
}

export function getBio() {
  return db.prepare('SELECT * FROM bio WHERE id = 1').get();
}

export function updateBio(fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE bio SET ${set} WHERE id = 1`).run(...keys.map((k) => fields[k]));
}

export function listCategories() {
  return db.prepare('SELECT * FROM categories ORDER BY sort_order ASC, name ASC').all();
}
export function getCategoryBySlug(slug) {
  return db.prepare('SELECT * FROM categories WHERE slug = ?').get(slug);
}
export function getCategory(id) {
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
}
export function createCategory({ name, slug, sort_order = 0 }) {
  return db.prepare('INSERT INTO categories (name, slug, sort_order) VALUES (?, ?, ?)').run(name, slug, sort_order)
    .lastInsertRowid;
}
export function updateCategory(id, { name, slug, sort_order }) {
  db.prepare('UPDATE categories SET name = ?, slug = ?, sort_order = ? WHERE id = ?').run(name, slug, sort_order, id);
}
export function deleteCategory(id) {
  db.prepare('UPDATE projects SET category_id = NULL WHERE category_id = ?').run(id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
}

export function listServices({ onlyPublished = false } = {}) {
  const sql = `SELECT * FROM services ${onlyPublished ? 'WHERE published = 1' : ''} ORDER BY sort_order ASC, id ASC`;
  return db.prepare(sql).all();
}
export function getService(id) {
  return db.prepare('SELECT * FROM services WHERE id = ?').get(id);
}
export function createService(data) {
  return db
    .prepare('INSERT INTO services (title, description, image, sort_order, published) VALUES (?, ?, ?, ?, ?)')
    .run(data.title, data.description || '', data.image || '', data.sort_order || 0, data.published ? 1 : 0)
    .lastInsertRowid;
}
export function updateService(id, data) {
  db.prepare('UPDATE services SET title=?, description=?, image=?, sort_order=?, published=? WHERE id=?').run(
    data.title,
    data.description || '',
    data.image || '',
    data.sort_order || 0,
    data.published ? 1 : 0,
    id
  );
}
export function deleteService(id) {
  db.prepare('DELETE FROM services WHERE id = ?').run(id);
}

export function listLinks() {
  return db.prepare('SELECT * FROM links ORDER BY sort_order ASC, id ASC').all();
}
export function createLink({ name, url, sort_order = 0 }) {
  return db.prepare('INSERT INTO links (name, url, sort_order) VALUES (?, ?, ?)').run(name, url, sort_order)
    .lastInsertRowid;
}
export function updateLink(id, { name, url, sort_order }) {
  db.prepare('UPDATE links SET name=?, url=?, sort_order=? WHERE id=?').run(name, url, sort_order, id);
}
export function deleteLink(id) {
  db.prepare('DELETE FROM links WHERE id = ?').run(id);
}

// ---------- Projetos ----------

function attachRelations(project) {
  if (!project) return project;
  project.videos = db
    .prepare('SELECT * FROM project_videos WHERE project_id = ? ORDER BY sort_order ASC, id ASC')
    .all(project.id);
  project.photos = db
    .prepare('SELECT * FROM photos WHERE project_id = ? ORDER BY sort_order ASC, id ASC')
    .all(project.id);
  if (project.category_id) {
    project.category = getCategory(project.category_id);
  }
  return project;
}

export function listProjects({ onlyPublished = false, categoryId = null, featuredOnly = false, limit = null } = {}) {
  const clauses = [];
  const params = [];
  if (onlyPublished) clauses.push('p.published = 1');
  if (categoryId) { clauses.push('p.category_id = ?'); params.push(categoryId); }
  if (featuredOnly) clauses.push('p.featured = 1');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const lim = limit ? `LIMIT ${Number(limit)}` : '';
  const rows = db
    .prepare(
      `SELECT p.*, c.name as category_name, c.slug as category_slug
       FROM projects p LEFT JOIN categories c ON c.id = p.category_id
       ${where}
       ORDER BY p.sort_order ASC, p.created_at DESC ${lim}`
    )
    .all(...params);
  return rows;
}

export function countProjects({ onlyPublished = false } = {}) {
  const sql = onlyPublished ? 'SELECT COUNT(*) as c FROM projects WHERE published = 1' : 'SELECT COUNT(*) as c FROM projects';
  return db.prepare(sql).get().c;
}
export function countPhotos() {
  return db.prepare('SELECT COUNT(*) as c FROM photos').get().c;
}
export function countCategories() {
  return db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
}

export function getProjectBySlug(slug) {
  const project = db
    .prepare(
      `SELECT p.*, c.name as category_name, c.slug as category_slug
       FROM projects p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.slug = ?`
    )
    .get(slug);
  return attachRelations(project);
}

export function getProject(id) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  return attachRelations(project);
}

export function createProject(data) {
  const now = new Date().toISOString();
  return db
    .prepare(
      `INSERT INTO projects (title, slug, category_id, description, project_date, location, cover_photo, credits, additional_info, published, featured, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
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
      now
    ).lastInsertRowid;
}

export function updateProject(id, data) {
  db.prepare(
    `UPDATE projects SET title=?, slug=?, category_id=?, description=?, project_date=?, location=?, cover_photo=?, credits=?, additional_info=?, published=?, featured=?, sort_order=?, updated_at=?
     WHERE id=?`
  ).run(
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
    id
  );
}

export function deleteProject(id) {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

export function listAllProjectsForAdmin() {
  return db
    .prepare(
      `SELECT p.*, c.name as category_name
       FROM projects p LEFT JOIN categories c ON c.id = p.category_id
       ORDER BY p.created_at DESC`
    )
    .all();
}

// ---------- Vídeos do projeto ----------
export function addProjectVideo(projectId, { provider, video_id, url, title, sort_order = 0 }) {
  return db
    .prepare('INSERT INTO project_videos (project_id, provider, video_id, url, title, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
    .run(projectId, provider, video_id || '', url, title || '', sort_order).lastInsertRowid;
}
export function deleteProjectVideo(id) {
  db.prepare('DELETE FROM project_videos WHERE id = ?').run(id);
}
export function getProjectVideo(id) {
  return db.prepare('SELECT * FROM project_videos WHERE id = ?').get(id);
}

// ---------- Fotos do projeto ----------
export function addPhoto(projectId, { filename, thumbFilename, caption = '', sort_order = 0, is_cover = 0 }) {
  return db
    .prepare('INSERT INTO photos (project_id, filename, thumb_filename, caption, is_cover, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
    .run(projectId, filename, thumbFilename, caption, is_cover, sort_order).lastInsertRowid;
}
export function getPhoto(id) {
  return db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
}
export function deletePhoto(id) {
  db.prepare('DELETE FROM photos WHERE id = ?').run(id);
}
export function setPhotoCaption(id, caption) {
  db.prepare('UPDATE photos SET caption = ? WHERE id = ?').run(caption, id);
}
export function setPhotoOrder(id, sort_order) {
  db.prepare('UPDATE photos SET sort_order = ? WHERE id = ?').run(sort_order, id);
}
// ---------- Marcas (clientes) ----------
export function listBrands() {
  return db.prepare('SELECT * FROM brands ORDER BY sort_order ASC, id ASC').all();
}
export function getBrand(id) {
  return db.prepare('SELECT * FROM brands WHERE id = ?').get(id);
}
export function createBrand({ name, logo, url = '', sort_order = 0 }) {
  return db.prepare('INSERT INTO brands (name, logo, url, sort_order) VALUES (?, ?, ?, ?)').run(name, logo, url, sort_order)
    .lastInsertRowid;
}
export function updateBrand(id, { name, logo, url, sort_order }) {
  db.prepare('UPDATE brands SET name=?, logo=?, url=?, sort_order=? WHERE id=?').run(name, logo, url || '', sort_order, id);
}
export function deleteBrand(id) {
  db.prepare('DELETE FROM brands WHERE id = ?').run(id);
}

// ---------- Pessoas (quem já trabalhou com a NJFILMES) ----------
export function listPeople() {
  return db.prepare('SELECT * FROM people ORDER BY sort_order ASC, id ASC').all();
}
export function getPerson(id) {
  return db.prepare('SELECT * FROM people WHERE id = ?').get(id);
}
export function createPerson({ name, role = '', photo, sort_order = 0 }) {
  return db.prepare('INSERT INTO people (name, role, photo, sort_order) VALUES (?, ?, ?, ?)').run(name, role, photo, sort_order)
    .lastInsertRowid;
}
export function updatePerson(id, { name, role, photo, sort_order }) {
  db.prepare('UPDATE people SET name=?, role=?, photo=?, sort_order=? WHERE id=?').run(name, role || '', photo, sort_order, id);
}
export function deletePerson(id) {
  db.prepare('DELETE FROM people WHERE id = ?').run(id);
}

export function setPhotoAsCover(projectId, photoId) {
  db.prepare('UPDATE photos SET is_cover = 0 WHERE project_id = ?').run(projectId);
  db.prepare('UPDATE photos SET is_cover = 1 WHERE id = ?').run(photoId);
  const photo = getPhoto(photoId);
  if (photo) db.prepare('UPDATE projects SET cover_photo = ? WHERE id = ?').run(photo.filename, projectId);
}

// ---------- Depoimentos (feedback de clientes em vídeo) ----------
export function listTestimonials() {
  return db.prepare('SELECT * FROM testimonials ORDER BY sort_order ASC, id ASC').all();
}
export function getTestimonial(id) {
  return db.prepare('SELECT * FROM testimonials WHERE id = ?').get(id);
}
export function createTestimonial({ client_name, role = '', provider, video_id = '', video_url, sort_order = 0 }) {
  return db
    .prepare('INSERT INTO testimonials (client_name, role, provider, video_id, video_url, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
    .run(client_name, role || '', provider, video_id || '', video_url, sort_order).lastInsertRowid;
}
export function updateTestimonial(id, { client_name, role, provider, video_id, video_url, sort_order }) {
  db.prepare('UPDATE testimonials SET client_name=?, role=?, provider=?, video_id=?, video_url=?, sort_order=? WHERE id=?').run(
    client_name,
    role || '',
    provider,
    video_id || '',
    video_url,
    sort_order,
    id
  );
}
export function deleteTestimonial(id) {
  db.prepare('DELETE FROM testimonials WHERE id = ?').run(id);
}
