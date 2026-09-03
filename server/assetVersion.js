// Versao compartilhada usada como "carimbo" (?v=) nas URLs dos arquivos estaticos fixos do site
// (CSS, JS, logo, fotos de fallback) — existe pra poder dar cache longo (1 ano) pra esses
// arquivos no navegador/CDN sem correr o risco de alguem ficar preso numa versao antiga depois
// de um deploy: como o valor muda sozinho a cada vez que o processo sobe (ou que o site estatico
// e gerado de novo, via scripts/build-static.js), a URL muda junto e o navegador busca a versao
// nova automaticamente, sem precisar lembrar de atualizar isso na mao em lugar nenhum.
export const ASSET_VERSION = String(Date.now());
