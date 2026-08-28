# Site NJFILMES — Guia Completo

Este é o site profissional da NJFILMES: página pública (Home, Portfólio, Sobre, Serviços, Contato) + painel administrativo em `/admin` totalmente funcional — login real, banco de dados real, upload real de fotos com otimização automática. Nada aqui é maquete: tudo que você mexer no painel realmente salva e aparece no site.

## Índice
1. Como funciona por baixo do capô (leia antes de tudo)
2. Como iniciar o site
3. Criar o primeiro administrador e entrar em `/admin`
4. Como usar o painel (projeto por projeto)
5. Alterar biografia, serviços, WhatsApp, marcas e pessoas
6. Publicar o site na internet de graça
7. Conectar o domínio NJFILMES.COM.BR
8. Serviços externos, custos e limites
9. Onde ficam as fotos e como fazer backup
10. Trocar sua senha

---

## 1. Como funciona por baixo do capô

Este site foi construído em **Node.js puro** (sem framework como Next.js/React), porque o ambiente onde ele foi criado não tinha acesso à internet para baixar pacotes. Isso não torna o site "menos real" — pelo contrário: **tudo funciona de verdade**:

- **Banco de dados real**: SQLite embutido no próprio Node.js (arquivo `data/njfilmes.sqlite`). Guarda projetos, fotos, categorias, serviços, marcas, pessoas, biografia e configurações.
- **Upload real de fotos**: as imagens são otimizadas e redimensionadas automaticamente (biblioteca `sharp`) e salvas em `public/uploads/`.
- **Login real**: senha protegida com criptografia (scrypt), sessão segura por cookie.
- **Zero dependências pesadas**: só precisa do pacote `sharp` para funcionar.

Isso significa que o site é leve, roda em qualquer hospedagem Node.js simples, e você (ou qualquer desenvolvedor no futuro) pode entender o código sem precisar aprender um framework.

## 2. Como iniciar o site (localmente, no seu computador)

Pré-requisito: ter o [Node.js](https://nodejs.org) versão 22 ou mais recente instalado.

```bash
cd njfilmes
npm install       # baixa o pacote sharp (só isso é necessário)
npm run seed      # cria as categorias, serviços e projetos de exemplo (só na 1ª vez)
npm start         # inicia o site
```

Abra `http://localhost:3000` no navegador. Pronto, o site já está no ar (localmente).

## 3. Criar o primeiro administrador e entrar em `/admin`

1. Acesse `http://localhost:3000/admin`.
2. Como ainda não existe nenhum administrador, o site mostra automaticamente a tela **"Criar o primeiro administrador"** — preencha seu nome, e-mail e uma senha.
3. Pronto — você já entra direto no painel.

Se quiser criar/redefinir um administrador pelo terminal (alternativa técnica), existe também:
```bash
node scripts/create-admin.js seuemail@exemplo.com "sua senha" "Seu Nome"
```

Da próxima vez, basta ir em `/admin` e fazer login normalmente.

## 4. Como usar o painel — passo a passo

**Adicionar um novo projeto (ex: um casamento):**
1. No menu lateral, clique em **Projetos → + Novo projeto**.
2. Preencha título, categoria, data, local e descrição. Marque "Publicado" quando quiser que apareça no site.
3. Salve — você será levado para a página de edição do projeto, com três abas: **Informações**, **Vídeos** e **Fotos**.

**Colocar um vídeo do YouTube ou Vimeo:**
1. Na aba **Vídeos** do projeto, cole o link do YouTube/Vimeo (ex: `https://www.youtube.com/watch?v=...`).
2. O site identifica automaticamente e incorpora o player — não precisa de nenhum código.

**Fazer upload de fotos:**
1. Na aba **Fotos**, clique na área de upload (ou arraste os arquivos) e selecione várias fotos de uma vez.
2. Elas são enviadas, otimizadas e uma miniatura é gerada automaticamente.
3. Você pode reordenar (setas ↑↓), definir a foto de capa, adicionar legenda ou excluir, tudo pelo painel.

**Categorias:** menu **Categorias** — criar, editar, reordenar ou excluir. Elas aparecem automaticamente no menu do site e nos filtros do portfólio.

## 5. Alterar biografia, serviços, WhatsApp, marcas e pessoas

- **Biografia/Sobre**: menu **Biografia / Sobre** — nome, título, biografia, trajetória, especialidades, foto de perfil. Aparece na página `/sobre`.
- **Serviços**: menu **Serviços** — crie, edite, publique/oculte e reordene os serviços mostrados na Home e em `/servicos`.
- **WhatsApp**: menu **Configurações** → campo "Número do WhatsApp" (formato: DDI+DDD+número, só números, ex: `5571986817816`) e a mensagem automática. O botão flutuante e os botões "Falar no WhatsApp" do site inteiro usam esse número — nunca fica fixo no código.
- **Redes sociais e SEO**: também em **Configurações**.
- **Marcas (clientes)**: menu **Marcas** — logo de cada marca/cliente que você já atendeu. Aparece como uma faixa de logos na Home. Já importei os logos reais que você me enviou (Davaca, Skol, Le Biscuit, Prefeitura de Salvador, Record TV, Assaí Atacadista, SBT).
- **Pessoas**: menu **Pessoas** — fotos de artistas/clientes que você já fotografou ou filmou, exibidas na página Sobre, separadas dos projetos. Já importei as 7 fotos que você mandou, mas coloquei nomes temporários (ex: "Artista convidada", "Convidado especial") — **edite cada uma em Pessoas → Editar e coloque o nome real**, já que eu não sabia quem eram.
- **Links externos**: menu **Links externos** — adicione qualquer link (TikTok, site, Linktree etc.) com nome + URL; aparece na página de Contato.

## 6. Publicar o site na internet de graça

Aqui vale uma explicação honesta, porque você pediu para não ter custo nenhum: **nenhuma hospedagem gratuita em 2026 oferece "tudo de graça, para sempre, sem nenhuma condição"** para um site que precisa manter um banco de dados e fotos salvas permanentemente. As opções reais são:

**Opção recomendada — Fly.io (gratuito dentro do limite, mas pede cartão de crédito para verificação):**
Tem "volumes" (disco persistente de verdade) no plano gratuito — ou seja, seu banco de dados e fotos NÃO são apagados quando o site reinicia. Para um site de portfólio com tráfego baixo/médio, o uso normalmente fica dentro da faixa gratuita.
1. Crie uma conta em [fly.io](https://fly.io).
2. Instale o `flyctl` (instruções no próprio site da Fly).
3. Dentro da pasta do projeto: `fly launch` (ele detecta que é Node.js).
4. Crie um volume: `fly volumes create dados_njfilmes --size 1` e monte-o no caminho `/app/data` e `/app/public/uploads` (o assistente do `fly launch` pergunta isso).
5. `fly deploy` para publicar.

**Alternativa mais simples de configurar, mas com uma ressalva — Render.com (grátis):**
Muito mais fácil de usar (conecta direto com um repositório no GitHub), mas o plano gratuito **não mantém disco persistente** — ou seja, fotos e banco de dados enviados pelo painel podem ser apagados quando o site "dorme" por inatividade ou é atualizado. Só recomendo essa opção se você aceitar migrar depois para um banco de dados externo (veja abaixo).

**Caminho para crescer sem dor de cabeça — Supabase (banco de dados e storage gratuitos "para sempre"):**
Quando o site crescer e você quiser mais estabilidade, o ideal é substituir o banco SQLite local por um banco Supabase (Postgres gratuito) e trocar a pasta de uploads pelo Supabase Storage (também tem plano gratuito permanente). Isso desacopla seus dados do servidor, então você pode usar hospedagens como Render sem medo de perder informação. Essa é uma mudança de código que qualquer desenvolvedor (ou eu, numa sessão com acesso à internet) consegue fazer depois, sem redesenhar o site.

## 7. Conectar o domínio NJFILMES.COM.BR

Depois de publicar o site em qualquer hospedagem (Fly.io, Render etc.), você recebe um endereço técnico (ex: `njfilmes.fly.dev`). Para usar seu domínio próprio:

1. Entre no painel do seu domínio (geralmente [registro.br](https://registro.br), se foi lá que você registrou o `.com.br`).
2. Procure por **"Editar Zona DNS"** ou **"Gerenciar DNS"**.
3. A hospedagem escolhida (Fly.io/Render) mostra, na tela de "Custom Domain", qual registro adicionar — normalmente:
   - Um registro **CNAME** apontando `www` para o endereço da hospedagem, e
   - Um registro **A** (ou "ALIAS"/"ANAME") apontando o domínio raiz (`njfilmes.com.br`) para o IP fornecido pela hospedagem.
4. Salve e aguarde a propagação (pode levar de alguns minutos a algumas horas).
5. Na hospedagem, adicione `njfilmes.com.br` e `www.njfilmes.com.br` como domínios customizados — a maioria já emite certificado HTTPS grátis automaticamente (Let's Encrypt).

## 8. Serviços externos usados, planos gratuitos e custos futuros

| O que | Serviço | Grátis? | Quando pode custar |
|---|---|---|---|
| Servidor do site | Fly.io (recomendado) | Sim, dentro do limite gratuito | Se o tráfego crescer muito além do normal de um portfólio |
| Banco de dados | SQLite embutido (sem serviço externo) | Sim, sempre | Nunca — é um arquivo local |
| Armazenamento de fotos | Disco local do servidor | Sim, sempre | Só se precisar de MUITO espaço (múltiplos GB) |
| Domínio | Você já possui (`njfilmes.com.br`) | Já pago por você | Renovação anual do domínio (não relacionado a este projeto) |
| Fontes (Bebas Neue, Inter) | Google Fonts | Sim, sempre grátis | Nunca |

Ou seja: **hoje, com Fly.io, o custo esperado é zero**, desde que o site não receba um volume de acessos muito fora do padrão de um portfólio.

## 9. Onde ficam as fotos e como fazer backup

- Banco de dados: `data/njfilmes.sqlite`
- Fotos e imagens enviadas: `public/uploads/` (subpastas `photos`, `thumbs`, `misc`)

**Backup simples:** copie periodicamente a pasta `data/` inteira e a pasta `public/uploads/` inteira para outro lugar (seu computador, um HD externo, Google Drive etc.). Isso é tudo que existe — restaurando essas duas pastas em qualquer servidor novo, o site volta exatamente como estava.

Se migrar para Fly.io, você pode baixar uma cópia do volume remoto com `fly ssh sftp get` ou simplesmente rodar `fly ssh console` e copiar os arquivos.

## 10. Trocar sua senha

Depois do primeiro acesso, troque a senha padrão em **Configurações → Minha conta**, informando a senha atual e a nova senha. Nunca precisa mexer em código para isso.

---

### Resumo rápido do que fazer agora
1. `npm install && npm run seed && npm start`
2. Abrir `/admin` e criar seu usuário
3. Trocar a senha em Configurações
4. Editar biografia, serviços, WhatsApp e as pessoas importadas (colocar os nomes reais)
5. Apagar os 3 projetos de exemplo (ou editá-los) e cadastrar seus trabalhos reais
6. Escolher a hospedagem (Fly.io recomendado) e publicar
7. Apontar o domínio njfilmes.com.br
