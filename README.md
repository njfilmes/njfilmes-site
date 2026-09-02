# Site NJFILMES — Guia Completo

Este é o site profissional da NJFILMES: página pública (Home, Portfólio, Sobre, Serviços, Contato) + painel administrativo em `/admin` totalmente funcional — login real, banco de dados real, upload real de fotos com otimização automática. Nada aqui é maquete: tudo que você mexer no painel realmente salva e aparece no site.

## Índice
1. Como funciona por baixo do capô (leia antes de tudo)
2. Como iniciar o site localmente (para testar no seu computador)
3. Criar o primeiro administrador e entrar em `/admin`
4. Como usar o painel (projeto por projeto)
5. Alterar biografia, serviços, WhatsApp, marcas e pessoas
6. Publicar o site na internet — passo a passo completo
7. Conectar o domínio NJFILMES.COM.BR
8. Serviços externos usados, planos gratuitos e custos futuros
9. Onde ficam as fotos e como fazer backup
10. Trocar sua senha

---

## 1. Como funciona por baixo do capô

Este site foi construído em **Node.js puro** (sem framework como Next.js/React) — leve, sem build step complicado, fácil de qualquer desenvolvedor entender no futuro. A arquitetura tem duas partes, publicadas como **dois serviços separados**, exatamente para que o site público nunca fique fora do ar:

- **Site público (Home, Portfólio, Sobre, Serviços, Contato)**: publicado como **HTML estático** (Render Static Site) — não "dorme" nunca, carrega instantaneamente e não depende do servidor estar ligado no momento em que alguém visita.
- **Painel administrativo (`/admin`) + API**: um serviço Node.js à parte (Render Web Service, plano gratuito), que cuida de login, cadastro de projetos/fotos/vídeos e das duas únicas ações que o site público precisa em tempo real — curtir um vídeo e contar visualização. Esse serviço pode "dormir" por inatividade (é só o painel que você usa, não o site que seus clientes veem) — na primeira vez que você acessa o admin depois de um tempo parado, pode levar uns 30-50 segundos pra acordar, e depois disso funciona normalmente.
- **Banco de dados real**: Postgres na [Neon](https://neon.tech) (plano gratuito, nunca expira). Guarda projetos, fotos, categorias, serviços, marcas, pessoas, biografia e configurações.
- **Fotos**: guardadas no [Vercel Blob](https://vercel.com/docs/vercel-blob) (plano gratuito), não no disco do servidor — assim elas nunca são perdidas quando o serviço reinicia ou é atualizado.
- **Login real**: senha protegida com criptografia (scrypt), sessão segura por cookie.
- **Republicação automática**: toda vez que você salva algo no painel (novo projeto, foto, edição, exclusão), o site público estático é reconstruído sozinho, em segundo plano — você não precisa fazer nada manualmente.

Do seu ponto de vista, usando o painel, **nada muda**: você cadastra projetos, sobe fotos, cola links de vídeo, exatamente como antes. A diferença é só por baixo do capô — e é o que garante que o site que seus clientes visitam nunca "durma" nem perca conteúdo.

## 2. Como iniciar o site localmente (para testar no seu computador)

Pré-requisito: ter o [Node.js](https://nodejs.org) versão 22 ou mais recente instalado, e um banco Postgres (pode ser o mesmo Neon que você usa em produção, ou um Postgres local).

```bash
cd njfilmes
npm install
DATABASE_URL="postgres://usuario:senha@host/banco" npm start
```

Abra `http://localhost:3000` no navegador. Esse modo local roda o site público e o painel juntos, no mesmo servidor (como um site tradicional) — é só para desenvolvimento/testes. Em produção, os dois ficam separados (seção 6).

Se a variável `BLOB_READ_WRITE_TOKEN` não estiver definida, o upload de fotos cai automaticamente para o disco local (pasta `public/uploads/`) — útil só para testar sem precisar configurar o Vercel Blob localmente.

## 3. Criar o primeiro administrador e entrar em `/admin`

1. Acesse `/admin` (local: `http://localhost:3000/admin`; em produção: o endereço do seu serviço de admin na Render).
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

**Colocar um vídeo do YouTube, Vimeo, Mega ou Google Drive:**
1. Na aba **Vídeos** do projeto, cole o link (YouTube, Vimeo, Mega ou Google Drive).
2. O site identifica automaticamente e incorpora o player — não precisa de nenhum código.
3. Logo abaixo do vídeo, o site já mostra o botão de curtir e o contador de visualizações, automaticamente.

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
- **Marcas (clientes)**: menu **Marcas** — logo de cada marca/cliente que você já atendeu. Aparece como uma faixa de logos na Home.
- **Pessoas**: menu **Pessoas** — fotos de artistas/clientes que você já fotografou ou filmou, exibidas na página Sobre, separadas dos projetos.
- **Links externos**: menu **Links externos** — adicione qualquer link (TikTok, site, Linktree etc.) com nome + URL; aparece na página de Contato.

## 6. Publicar o site na internet — passo a passo completo

São 4 contas gratuitas (Neon, Vercel, GitHub, Render) e 2 serviços criados na Render. Parece mais passo a passo do que realmente é — cada etapa é rápida.

### 6.1 Banco de dados (Neon)

1. Crie uma conta em [neon.tech](https://neon.tech) e um projeto novo (qualquer nome, ex: "njfilmes").
2. Na tela do projeto, copie a **Connection string** (algo como `postgres://usuario:senha@ep-xxxx.neon.tech/neondb?sslmode=require`). Isso é o valor de `DATABASE_URL`.

### 6.2 Armazenamento de fotos (Vercel Blob)

1. Crie uma conta em [vercel.com](https://vercel.com) (não precisa cartão de crédito no plano Hobby).
2. Crie um projeto qualquer (só serve como "gaveta" para o Blob Store — pode ser vazio).
3. No projeto, vá em **Storage → Create Database → Blob**, escolha público, dê um nome e crie. Marque também o ambiente "Development".
4. Vá em **Settings → Environment Variables**, encontre a linha `BLOB_READ_WRITE_TOKEN`, clique no ícone de revelar e copie o valor.

### 6.3 Subir o código para o GitHub

Se o código já está em `github.com/njfilmes/njfilmes-site` (como está), pode pular esta etapa — só garanta que a versão mais recente foi enviada (`git push`).

### 6.4 Serviço 1 — Painel administrativo + API (Render Web Service)

1. Em [render.com](https://render.com), **New → Web Service**, conecte o repositório `njfilmes-site`.
2. Configuração: **Build Command** `npm install`, **Start Command** `npm start`, plano **Free**.
3. Em **Environment**, adicione as variáveis:
   - `DATABASE_URL` → a connection string da Neon (passo 6.1)
   - `BLOB_READ_WRITE_TOKEN` → o token do Vercel Blob (passo 6.2)
   - `SITE_URL` → `https://njfilmes.com.br`
   - `ALLOWED_ORIGINS` → `https://njfilmes.com.br,https://www.njfilmes.com.br`
4. Crie o serviço. Depois que ele terminar de subir, anote a URL que a Render deu a ele (ex: `https://njfilmes-admin.onrender.com`) — é nela que você vai acessar `/admin`.

### 6.5 Serviço 2 — Site público (Render Static Site)

1. Em [render.com](https://render.com), **New → Static Site**, conecte o mesmo repositório.
2. Configuração: **Build Command** `npm install && npm run build-static`, **Publish Directory** `dist`.
3. Em **Environment**, adicione as variáveis (usadas só durante a geração do site, não em tempo real):
   - `DATABASE_URL` → a mesma connection string da Neon
   - `SITE_URL` → `https://njfilmes.com.br`
   - `PUBLIC_API_BASE` → a URL do Serviço 1 que você anotou (ex: `https://njfilmes-admin.onrender.com`) — é assim que o botão de curtir e o contador de visualizações, mesmo estando numa página estática, sabem para onde chamar.
4. Crie o serviço.
5. Depois de criado, vá em **Settings → Deploy Hook**, copie a URL gerada, e volte no **Serviço 1** (o Web Service) para adicionar mais uma variável de ambiente:
   - `STATIC_DEPLOY_HOOK_URL` → a URL do Deploy Hook que você acabou de copiar.
6. Salve — isso reinicia o Serviço 1, e a partir de agora, toda vez que você salvar algo no painel, o site público se reconstrói sozinho automaticamente.

Pronto — o site público (rápido, sempre disponível) e o painel administrativo (onde você cadastra tudo) estão publicados e conectados.

## 7. Conectar o domínio NJFILMES.COM.BR

O domínio `njfilmes.com.br` já está conectado (você confirmou isso — o site responde em `njfilmes.com.br` normalmente). Depois de publicar a nova versão (seção 6), aponte o domínio custom para o **Serviço 2 (Static Site)** — é ele que deve responder em `njfilmes.com.br`, já que é o site público. O painel administrativo continua acessível apenas pelo endereço técnico da Render (ex: `njfilmes-admin.onrender.com/admin`), sem precisar de domínio próprio.

Se precisar reconectar do zero em qualquer hospedagem:
1. Na hospedagem, na tela de **Custom Domain** do serviço, adicione `njfilmes.com.br` e `www.njfilmes.com.br`.
2. No painel do seu domínio (registro.br ou onde você registrou), adicione os registros DNS que a hospedagem indicar (geralmente um CNAME para `www` e um registro A/ALIAS para o domínio raiz).
3. Aguarde a propagação (minutos a poucas horas) — o certificado HTTPS é emitido automaticamente.

## 8. Serviços externos usados, planos gratuitos e custos futuros

| O que | Serviço | Grátis? | Quando pode custar |
|---|---|---|---|
| Site público | Render Static Site | Sim, sempre — não tem custo por não "dormir" | Praticamente nunca, para um site de portfólio |
| Painel + API | Render Web Service (Free) | Sim, dentro do limite gratuito | Se quiser que o painel nunca "durma" (plano pago a partir de ~US$7/mês) |
| Banco de dados | Neon (Postgres, Free) | Sim, não expira nem pausa permanentemente | Se o volume de dados/uso crescer muito além de um portfólio |
| Fotos | Vercel Blob (Free) | Sim — até ~5GB de armazenamento, 100GB de transferência/mês | Se ultrapassar esses limites (bloqueia até o próximo mês, não cobra sozinho) |
| Domínio | Você já possui (`njfilmes.com.br`) | Já pago por você | Renovação anual do domínio (não relacionado a este projeto) |
| Fontes (Fraunces, Inter) | Google Fonts | Sim, sempre grátis | Nunca |

Ou seja: **o custo esperado hoje é zero**, dentro do uso normal de um portfólio.

## 9. Onde ficam as fotos e como fazer backup

- Banco de dados: Postgres na Neon (não é mais um arquivo local) — o backup mais simples é usar a própria função de backup/branch da Neon no painel do projeto.
- Fotos: Vercel Blob — pelo painel do projeto na Vercel (Storage → seu Blob Store) você vê e pode baixar todos os arquivos.

Como os dois ficam fora do servidor, você não perde nada mesmo se recriar os serviços da Render do zero — é só reconectar as mesmas variáveis de ambiente (`DATABASE_URL` e `BLOB_READ_WRITE_TOKEN`).

## 10. Trocar sua senha

Depois do primeiro acesso, troque a senha padrão em **Configurações → Minha conta**, informando a senha atual e a nova senha. Nunca precisa mexer em código para isso.

---

### Resumo rápido do que fazer agora
1. Criar conta na Neon e copiar a `DATABASE_URL`
2. Criar conta na Vercel, criar um Blob Store e copiar o `BLOB_READ_WRITE_TOKEN`
3. Criar o Web Service (painel + API) na Render com essas variáveis
4. Criar o Static Site (site público) na Render, apontando `PUBLIC_API_BASE` para o Web Service
5. Copiar o Deploy Hook do Static Site e colar como `STATIC_DEPLOY_HOOK_URL` no Web Service
6. Apontar `njfilmes.com.br` para o Static Site
7. Testar: acessar o site público, fazer login no admin, cadastrar um projeto e conferir que aparece no site
