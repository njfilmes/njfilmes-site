// Popula o banco com os dados reais da NJFILMES (mais alguns projetos de demonstração,
// claramente identificados como exemplo). Pode ser rodado quantas vezes quiser: só cria o que
// ainda não existe. A lógica em si vive em server/seedData.js, pra poder ser reaproveitada por
// uma rota do painel administrativo (usada quando não há acesso a terminal no servidor).
import { runSeed } from '../server/seedData.js';

await runSeed();
