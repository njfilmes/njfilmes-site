// Banco de dados real da NJFILMES usando node:sqlite (embutido no Node.js, sem dependências externas).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'njfilmes.sqlite');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS admin_users (
id INTEGER PRIMARY KEY AUTOINCREMENT,
email TEXT UNIQUE NOT NULL,
password_hash TEXT NOT NULL,
salt TEXT NOT NULL,
name TEXT,
created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
id TEXT PRIMARY KEY,
admin_id INTEGER NOT NULL,
expires_at TEXT NOT NULL,
created_at TEXT NOT NULL DEFAULT (datetime('now')),
FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

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
footer_text TEXT DEFAULT 'NJFILMES — Produção Audiovisual. Salvador, BA.'
);

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

CREATE TABLE IF NOT EXISTS categories (
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT NOT NULL,
slug TEXT UNIQUE NOT NULL,
sort_order INTEGER NOT NULL DEFAULT 0,
created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS services (
id INTEGER PRIMARY KEY AUTOINCREMENT,
title TEXT NOT NULL,
description TEXT DEFAULT '',
image TEXT DEFAULT '',
sort_order INTEGER NOT NULL DEFAULT 0,
published INTEGER NOT NULL DEFAULT 1,
created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS links (
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT NOT NULL,
url TEXT NOT NULL,
sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projects (
id INTEGER PRIMARY KEY AUTOINCREMENT,
title TEXT NOT NULL,
slug TEXT UNIQUE NOT NULL,
category_id INTEGER,
description TEXT DEFAULT '',
project_date TEXT DEFAULT '',
location TEXT DEFAULT '',
cover_photo TEXT DEFAULT '',
credits TEXT DEFAULT '',
additional_info TEXT DEFAULT '',
published INTEGER NOT NULL DEFAULT 0,
featured INTEGER NOT NULL DEFAULT 0,
sort_order INTEGER NOT NULL DEFAULT 0,
created_at TEXT NOT NULL DEFAULT (datetime('now')),
updated_at TEXT NOT NULL DEFAULT (datetime('now')),
FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS project_videos (
id INTEGER PRIMARY KEY AUTOINCREMENT,
project_id INTEGER NOT NULL,
provider TEXT NOT NULL,
video_id TEXT DEFAULT '',
url TEXT NOT NULL,
title TEXT DEFAULT '',
sort_order INTEGER NOT NULL DEFAULT 0,
FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS photos (
id INTEGER PRIMARY KEY AUTOINCREMENT,
project_id INTEGER NOT NULL,
filename TEXT NOT NULL,
thumb_filename TEXT NOT NULL,
caption TEXT DEFAULT '',
is_cover INTEGER NOT NULL DEFAULT 0,
sort_order INTEGER NOT NULL DEFAULT 0,
created_at TEXT NOT NULL DEFAULT (datetime('now')),
FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS brands (
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT NOT NULL,
logo TEXT NOT NULL,
url TEXT DEFAULT '',
sort_order INTEGER NOT NULL DEFAULT 0,
created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS people (
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT NOT NULL,
role TEXT DEFAULT '',
photo TEXT NOT NULL,
sort_order INTEGER NOT NULL DEFAULT 0,
created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_category ON projects(category_id);
CREATE INDEX IF NOT EXISTS idx_photos_project ON photos(project_id);
CREATE INDEX IF NOT EXISTS idx_videos_project ON project_videos(project_id);
`);

// Garante que exista sempre exatamente uma linha de settings e de bio (singletons).
db.exec(`INSERT OR IGNORE INTO settings (id) VALUES (1);`);
db.exec(`INSERT OR IGNORE INTO bio (id) VALUES (1);`);

// Ajuste pontual de conteúdo (pedido pelo usuário em 29/08/2026): troca a frase de
// destaque do hero, mas só se ela ainda estiver exatamente com o texto anterior —
// assim, se você já tiver editado essa frase pelo painel depois disso, este trecho
// não sobrescreve o que você escreveu. É seguro deixar este código no ar: depois da
// primeira troca ele nunca mais faz nada.
try {
const HERO_ANTERIOR = 'Nem todos os momentos podem ser capturados. Os que podem, merecem ser eternizados.';
const HERO_NOVA = 'Vamos tirar sua ideia do papel?';
const row = db.prepare('SELECT hero_headline FROM settings WHERE id = 1').get();
if (row && row.hero_headline === HERO_ANTERIOR) {
db.prepare('UPDATE settings SET hero_headline = ? WHERE id = 1').run(HERO_NOVA);
}
} catch (err) {
console.error('[patch] falha ao tentar atualizar hero_headline:', err);
}

try { const rowYt = db.prepare('SELECT youtube_url FROM settings WHERE id = 1').get(); if (rowYt && !rowYt.youtube_url) { db.prepare('UPDATE settings SET youtube_url = ? WHERE id = 1').run('https://www.youtube.com/@njfilmesproduções'); } } catch (err) { console.error('[patch] falha ao tentar atualizar youtube_url:', err); } try { const bioRow = db.prepare('SELECT specialties FROM bio WHERE id = 1').get(); if (bioRow && bioRow.specialties && !/v[ií]deos?\s+corporativos?/i.test(bioRow.specialties)) { db.prepare('UPDATE bio SET specialties = ? WHERE id = 1').run(bioRow.specialties.trim() + ', Vídeos corporativos'); } } catch (err) { console.error('[patch] falha ao tentar atualizar specialties:', err); } try { const PEOPLE_SEED = [ { name: 'MC Soffia', photo: '/img/clients/mc-soffia-web.jpg' }, { name: 'Milena Barreto', photo: '/img/clients/milena-barreto-web.jpg' }, { name: 'Armandinho Macêdo', photo: '/img/clients/armandinho-macedo-web.jpg' }, { name: 'A Dama', photo: '/img/clients/a-dama-web.jpg' }, { name: 'Dana Mazzei', photo: '/img/clients/dana-mazzei-web.jpg' }, { name: 'Juliana Paiva', photo: '/img/clients/juliana-paiva-web.jpg' }, { name: 'Tairine Ceuta', photo: '/img/clients/tairine-ceuta-web.jpg' }, { name: 'Leozito', photo: '/img/clients/leozito-web.jpg' }, { name: 'Alceu Valença', photo: '/img/clients/alceu-valenca-confirmado-web.jpg' }, { name: 'Sandro Souza', photo: '/img/clients/sandro-souza-web.jpg' }, { name: 'Flávia Paixão', photo: '/img/clients/flavia-paixao-web.jpg' } ]; const existingPeople = db.prepare('SELECT name FROM people').all().map((r) => r.name); const insertPerson = db.prepare('INSERT INTO people (name, role, photo) VALUES (?, ?, ?)'); for (const p of PEOPLE_SEED) { if (!existingPeople.includes(p.name)) insertPerson.run(p.name, '', p.photo); } } catch (err) { console.error('[patch] falha ao tentar semear people:', err); } try { const BRANDS_SEED = [ { name: 'Rennova', logo: '/img/clients/rennova-logo-web.png' }, { name: 'AXE', logo: '/img/clients/axe-logo-web.png' } ]; const existingBrands = db.prepare('SELECT name FROM brands').all().map((r) => r.name); const insertBrand = db.prepare('INSERT INTO brands (name, logo) VALUES (?, ?)'); for (const b of BRANDS_SEED) { if (!existingBrands.includes(b.name)) insertBrand.run(b.name, b.logo); } } catch (err) { console.error('[patch] falha ao tentar semear brands:', err); } try { const OLD_PHOTOS = ['/uploads/misc/25fa89f3de4cbb7a.webp', '/uploads/misc/abbbd2b9c54c558e.webp', '/uploads/misc/6c26648898e0f7b5.webp', '/uploads/misc/e85c26b81ccb818f.webp', '/uploads/misc/659ae5dd28192059.webp', '/uploads/misc/9467bd77d2a5fbed.webp', '/uploads/misc/17ab5f5792f33ecf.webp']; const delPerson = db.prepare('DELETE FROM people WHERE photo = ?'); for (const ph of OLD_PHOTOS) { delPerson.run(ph); } } catch (err) { console.error('[patch] falha ao tentar remover fotos antigas genericas:', err); } try { const BRANDS_SEED_2 = [ { name: 'A Bofetada', logo: '/img/clients/a-bofetada-web.jpg' }, { name: 'A Clínica da Mulher', logo: '/img/clients/clinica-da-mulher-web.png', url: 'https://aclinicadamulher.com.br/' } ]; const existingBrands2 = db.prepare('SELECT name FROM brands').all().map((r) => r.name); const insertBrand2 = db.prepare('INSERT INTO brands (name, logo, url) VALUES (?, ?, ?)'); for (const b of BRANDS_SEED_2) { if (!existingBrands2.includes(b.name)) insertBrand2.run(b.name, b.logo, b.url || null); } } catch (err) { console.error('[patch] falha ao tentar semear novos brands:', err); } try { const PEOPLE_SEED_2 = [ { name: 'Henrique Bahia', photo: '/img/clients/henrique-bahia-web.jpg' } ]; const existingPeople2 = db.prepare('SELECT name FROM people').all().map((r) => r.name); const insertPerson2 = db.prepare('INSERT INTO people (name, role, photo) VALUES (?, ?, ?)'); for (const p of PEOPLE_SEED_2) { if (!existingPeople2.includes(p.name)) insertPerson2.run(p.name, '', p.photo); } } catch (err) { console.error('[patch] falha ao tentar semear novos people:', err); } try { const BRANDS_SEED_3 = [ { name: 'Band TV', logo: '/img/clients/band-tv-web.png' }, { name: 'Kangerê de Sinhá', logo: '/img/clients/kangere-de-sinha-web.png' }, { name: 'Salvador Shopping', logo: '/img/clients/salvador-shopping-web.png' }, { name: 'Band News FM', logo: '/img/clients/band-news-fm-web.png' }, { name: 'Casacor', logo: '/img/clients/logo-cc-web.png' }, { name: 'Caramurê', logo: '/img/clients/caramure-web.png' }, { name: 'Sesc', logo: '/img/clients/sesc-web.png' }, { name: 'Rockhair Barbearia', logo: '/img/clients/rockhair-barbearia-web.png', url: 'https://paseoitaigara.com.br/servicos/rockhair-barbearia/' } ]; const existingBrands3 = db.prepare('SELECT name FROM brands').all().map((r) => r.name); const insertBrand3 = db.prepare('INSERT INTO brands (name, logo, url) VALUES (?, ?, ?)'); for (const b of BRANDS_SEED_3) { if (!existingBrands3.includes(b.name)) insertBrand3.run(b.name, b.logo, b.url || null); } } catch (err) { console.error('[patch] falha ao tentar semear novos brands 3:', err); } try { db.prepare("UPDATE brands SET logo = ? WHERE name = 'Le Biscuit' AND logo = '/uploads/misc/93c0284686f6f604.webp'").run('/img/clients/le-biscuit-web.png'); } catch (err) { console.error('[patch] falha ao tentar trocar logo do Le Biscuit:', err); } try { const PEOPLE_SEED_3 = [ { name: 'Thiago Arancam', photo: '/img/clients/thiago-arancam-web.jpg' } ]; const existingPeople3 = db.prepare('SELECT name FROM people').all().map((r) => r.name); const insertPerson3 = db.prepare('INSERT INTO people (name, role, photo) VALUES (?, ?, ?)'); for (const p of PEOPLE_SEED_3) { if (!existingPeople3.includes(p.name)) insertPerson3.run(p.name, '', p.photo); } } catch (err) { console.error('[patch] falha ao tentar semear novos people 3:', err); } export function nowIso() {
return new Date().toISOString();
}
