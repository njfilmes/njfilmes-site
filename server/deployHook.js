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
const HOOK_URL = process.env.STATIC_DEPLOY_HOOK_URL || '';

let building = false;
let queuedAgain = false;

export function triggerStaticRebuild() {
  if (!HOOK_URL) return;

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
      } else {
        console.log('Rebuild do site estático disparado com sucesso.');
      }
    })
    .catch((err) => {
      console.error('Falha ao chamar o deploy hook do site estático:', err.message);
    })
    .finally(() => {
      building = false;
      if (queuedAgain) {
        queuedAgain = false;
        triggerStaticRebuild();
      }
    });
}
