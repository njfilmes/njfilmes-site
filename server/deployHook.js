// Republicação automática do site estático: toda vez que algo muda pelo painel administrativo
// (criar/editar/excluir categoria, projeto, foto, vídeo, etc.), a Render precisa gerar o site
// estático de novo — senão o visitante continuaria vendo a versão antiga. Isso é feito chamando
// o "Deploy Hook" do serviço Static Site na Render (uma URL secreta que, ao receber um POST,
// dispara um novo build/publicação automaticamente).
//
// Configuração: defina a variável de ambiente STATIC_DEPLOY_HOOK_URL com essa URL (copiada da
// aba "Settings" do serviço Static Site na Render, em "Deploy Hook"). Enquanto essa variável não
// estiver definida (por exemplo, antes de o Static Site existir, ou em desenvolvimento local),
// isso é simplesmente ignorado — nenhuma chamada é feita e nada quebra.
// Registra sucesso/falha + horário da última tentativa de publicação num lugar que o painel
// consegue mostrar (tabela app_status, ver server/db.js) — adicionado em 04/09/2026 porque antes
// disso essa chamada só logava no console do servidor (que ninguém vê no dia a dia): se a URL do
// hook expirasse ou o build falhasse, o conteúdo simplesmente não aparecia no site, sem nenhum
// aviso em lugar nenhum. Importado de forma tardia (dentro da função) pra evitar qualquer risco
// de dependência circular com queries.js/db.js e pra este arquivo continuar funcionando mesmo se,
// por algum motivo, o banco ainda não estiver pronto quando ele for carregado.
async function recordRebuildStatus(ok, detail) {
  try {
    const { setAppStatus } = await import('./queries.js');
    await setAppStatus('static_rebuild', JSON.stringify({ ok, detail: detail || '', at: new Date().toISOString() }));
  } catch (err) {
    // Não deixa uma falha ao *registrar* o status derrubar nada — o rebuild em si já rodou.
    console.error('Falha ao registrar status da publicação:', err.message);
  }
}

const HOOK_URL = process.env.STATIC_DEPLOY_HOOK_URL || '';

let building = false;
let queuedAgain = false;

export function triggerStaticRebuild() {
  if (!HOOK_URL) {
    recordRebuildStatus(false, 'STATIC_DEPLOY_HOOK_URL não configurada neste serviço.');
    return;
  }

  // Se um build já está sendo disparado, não empilha vários pedidos — só marca que, quando
  // esse terminar, precisa disparar mais um (cobre o caso de várias edições em sequência rápida).
  if (building) {
    queuedAgain = true;
    return;
  }
  building = true;

  fetch(HOOK_URL, { method: 'POST' })
    .then((res) => {
      if (!res.ok) {
        console.error(`Deploy hook do site estático respondeu ${res.status}.`);
        recordRebuildStatus(false, `O serviço de publicação respondeu com erro (status ${res.status}).`);
      } else {
        console.log('Rebuild do site estático disparado com sucesso.');
        recordRebuildStatus(true, '');
      }
    })
    .catch((err) => {
      console.error('Falha ao chamar o deploy hook do site estático:', err.message);
      recordRebuildStatus(false, `Falha de conexão ao disparar a publicação: ${err.message}`);
    })
    .finally(() => {
      building = false;
      if (queuedAgain) {
        queuedAgain = false;
        triggerStaticRebuild();
      }
    });
}
