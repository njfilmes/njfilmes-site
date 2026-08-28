// Popula o banco com conteúdo de demonstração (claramente fictício) para o site não ficar vazio,
// além de já deixar configurados os dados reais que a NJFILMES informou (WhatsApp, Instagram, bio).
// Pode ser rodado quantas vezes quiser: só cria o que ainda não existe.
import { db } from '../server/db.js';
import * as Q from '../server/queries.js';
import { slugify, uniqueSlug } from '../server/util.js';

function ensureCategory(name) {
  const existing = db.prepare('SELECT * FROM categories WHERE slug = ?').get(slugify(name));
  if (existing) return existing.id;
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM categories').get().m;
  return Q.createCategory({ name, slug: slugify(name), sort_order: maxOrder + 1 });
}

const categoryNames = ['Casamentos', 'Eventos', 'Videoclipes', 'Institucional', 'Artistas', 'Drone', 'Fotografia', 'Reels / Conteúdo'];
const categoryIds = {};
for (const name of categoryNames) {
  categoryIds[name] = ensureCategory(name);
}
console.log('Categorias garantidas:', categoryNames.join(', '));

// Configurações com os dados reais informados pela NJFILMES
Q.updateSettings({
  site_name: 'NJFILMES',
  tagline: 'Produção audiovisual cinematográfica',
  whatsapp_number: '5571986817816',
  whatsapp_message: 'Olá! Vim pelo site e gostaria de solicitar um orçamento com a NJFILMES.',
  instagram_url: 'https://instagram.com/njfilmes',
  youtube_url: '',
  vimeo_url: '',
  tiktok_url: '',
  facebook_url: '',
  hero_video_url: '',
  hero_headline: 'Nem todos os momentos podem ser capturados. Os que podem, merecem ser eternizados.',
  hero_subheadline: 'Produção audiovisual, fotografia e drone para eventos, casamentos, artistas e marcas em Salvador, BA.',
  meta_title: 'NJFILMES — Produção Audiovisual em Salvador, BA',
  meta_description: 'NJFILMES: produção de vídeos, fotografia, cobertura de eventos, casamentos, videoclipes, conteúdo para artistas e filmagens com drone em Salvador, Bahia.',
  footer_text: 'NJFILMES — Produção Audiovisual. Salvador, BA.',
});
console.log('Configurações atualizadas com os dados reais da NJFILMES.');

// Biografia com os dados reais informados
Q.updateBio({
  name: 'Noberto Junior (NJ)',
  professional_title: 'Videomaker & Fotógrafo — NJFILMES',
  biography:
    'Sou o NJ, fundador da NJFILMES. Comecei em 2015 criando conteúdo para YouTube e plataformas digitais, e desde então venho construindo uma trajetória dedicada a transformar momentos em imagens que ficam. Hoje atendo casamentos, eventos, artistas e marcas em Salvador, Bahia, e região.',
  trajectory:
    'Iniciei minha jornada no audiovisual em 2015 como criador de conteúdo digital. Com o tempo, me aprofundei em fotografia e vídeo profissional, atendendo clientes como Band TV, Salvador Shopping, Davaca, ComSabor, Assaí Atacadista, Le Biscuit e Tramontina. Nem todos os momentos especiais podem ser capturados, mas acredito que aqueles que podem, merecem ser eternizados.',
  specialties: 'Ensaio fotográfico externo\nFotografia de família\nCobertura de eventos\nVideografia\nCasamentos\nDrone',
  equipment: '',
  profile_photo: '',
  cta_text: 'Vamos criar algo juntos?',
});
console.log('Biografia atualizada com os dados reais informados.');

// Serviços (a partir do briefing original da NJFILMES)
const services = [
  ['Produção audiovisual completa', 'Do roteiro à entrega final: planejamento, captação e pós-produção para qualquer tipo de projeto.'],
  ['Filmagem de eventos', 'Cobertura completa de eventos corporativos, sociais e culturais.'],
  ['Edição de vídeo', 'Montagem, color grading e finalização com padrão cinematográfico.'],
  ['Fotografia profissional', 'Ensaios, eventos e cobertura fotográfica com tratamento de imagem incluso.'],
  ['Filmagem com drone', 'Imagens aéreas para casamentos, eventos, imóveis e conteúdo institucional.'],
  ['Videoclipes', 'Produção completa de clipes musicais para artistas, do conceito à direção de arte.'],
  ['Casamentos', 'Filme e fotos do seu casamento com narrativa emocional e cinematográfica.'],
  ['Vídeos institucionais', 'Conteúdo corporativo para apresentar sua marca com profissionalismo.'],
  ['Conteúdo para redes sociais', 'Reels, bastidores e conteúdo dinâmico para Instagram e TikTok.'],
];
let order = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM services').get().m;
for (const [title, description] of services) {
  const exists = db.prepare('SELECT id FROM services WHERE title = ?').get(title);
  if (exists) continue;
  order += 1;
  Q.createService({ title, description, sort_order: order, published: true });
}
console.log('Serviços garantidos.');

// Projetos de demonstração (conteúdo fictício, claramente identificado como exemplo)
const demoProjects = [
  {
    title: 'Casamento de João & Maria (exemplo)',
    category: 'Casamentos',
    description: 'Projeto de demonstração para mostrar como um casamento aparece no site: filme principal, fotos e detalhes do dia. Substitua pelo seu primeiro casamento real pelo painel administrativo.',
    location: 'Salvador, BA',
    project_date: '2026-05-10',
    featured: true,
    video: '',
  },
  {
    title: 'Clipe Artista Exemplo (exemplo)',
    category: 'Videoclipes',
    description: 'Projeto de demonstração de videoclipe. Para ver a incorporação automática de vídeo funcionando, edite este projeto pelo painel e cole o link de um YouTube/Vimeo real na aba "Vídeos".',
    location: 'Salvador, BA',
    project_date: '2026-03-02',
    featured: false,
    video: '',
  },
  {
    title: 'Evento Corporativo Exemplo (exemplo)',
    category: 'Eventos',
    description: 'Projeto de demonstração de cobertura de evento corporativo, com fotos e vídeo aftermovie.',
    location: 'Salvador, BA',
    project_date: '2026-01-20',
    featured: false,
    video: '',
  },
];

for (const p of demoProjects) {
  const existing = db.prepare('SELECT id FROM projects WHERE title = ?').get(p.title);
  if (existing) continue;
  const slug = await uniqueSlug(db, 'projects', p.title);
  const id = Q.createProject({
    title: p.title,
    slug,
    category_id: categoryIds[p.category] || null,
    description: p.description,
    project_date: p.project_date,
    location: p.location,
    credits: 'Direção e edição: NJFILMES',
    additional_info: '',
    published: true,
    featured: p.featured,
  });
  if (p.video) {
    const { parseVideoUrl } = await import('../server/util.js');
    const parsed = parseVideoUrl(p.video);
    if (parsed) Q.addProjectVideo(id, { provider: parsed.provider, video_id: parsed.videoId, url: parsed.url, title: 'Filme completo', sort_order: 1 });
  }
  console.log('Projeto de exemplo criado:', p.title);
}

console.log('\nSeed concluído. Esses são dados de EXEMPLO — substitua pelo conteúdo real da NJFILMES pelo painel /admin.');
