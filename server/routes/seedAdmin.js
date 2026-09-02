// Rota temporária de configuração inicial (migração de banco de dados). Usada uma única vez para
// popular um banco novo (ex.: depois de migrar para o Neon) com os dados reais da NJFILMES, sem
// precisar de acesso a terminal no servidor. Protegida pelo mesmo login de administrador de todo
// o painel (ver server/index.js). Fica num arquivo separado, pequeno, pra não precisar reescrever
// o arquivo grande server/routes/admin.js inteiro.
import { adminLayout } from '../adminRender.js';
import { escapeHtml } from '../util.js';
import { runSeed } from '../seedData.js';

export async function seedPage(req, res, admin) {
  const content = `
  <div class="panel">
    <h2>Popular banco de dados com os dados reais</h2>
    <p class="sub">Use isso uma vez depois de configurar um banco de dados novo (ex.: Neon). Cria marcas, pessoas, biografia, serviços e configurações reais da NJFILMES — não duplica nada se já existir.</p>
    <form method="post" action="/admin/rodar-seed-inicial">
      <div class="form-actions"><button class="btn-a btn-a-primary" type="submit">Rodar agora</button></div>
    </form>
  </div>`;
  res.end(adminLayout({ title: 'Configuração inicial', activePath: '/admin/rodar-seed-inicial', admin, content }));
}

export async function seedSubmit(req, res, admin) {
  let log = [];
  let error = null;
  try {
    log = await runSeed();
  } catch (err) {
    error = err.message || String(err);
  }
  const content = `
  <div class="panel">
    <h2>${error ? 'Erro ao rodar' : 'Concluído'}</h2>
    ${error ? `<p style="color:#d0503a;">${escapeHtml(error)}</p>` : `<pre style="white-space:pre-wrap;">${escapeHtml(log.join('\n'))}</pre>`}
    <a class="btn-a" href="/admin">Voltar ao dashboard</a>
  </div>`;
  res.end(adminLayout({ title: 'Configuração inicial', activePath: '/admin/rodar-seed-inicial', admin, content }));
}
