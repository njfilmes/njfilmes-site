// JS do painel administrativo: menu mobile, preview/upload de fotos, confirmação de exclusão.
(function () {
  'use strict';

  const menuToggle = document.querySelector('[data-admin-menu-toggle]');
  const sidebar = document.querySelector('.admin-sidebar');
  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
  }

  // Confirmação antes de excluir qualquer item
  document.querySelectorAll('[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (!confirm(form.dataset.confirm || 'Tem certeza que deseja excluir?')) {
        e.preventDefault();
      }
    });
  });

  // Corrigido em 03/09/2026: sem isso, se o usuário soltasse o arquivo alguns pixels fora
  // da área de upload (ou o navegador não reconhecesse o "drop" por algum motivo), o
  // Chrome/Firefox tentam abrir a foto direto na aba (saindo do painel) em vez de simplesmente
  // ignorar — o que parecia "arrastar e soltar não faz nada". Bloqueia esse comportamento
  // padrão em toda a página; as áreas de upload continuam com sua própria lógica de arrastar.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // Corrigido em 03/09/2026: ao clicar em "Clique aqui..." e escolher fotos pelo seletor do
  // sistema, o navegador sempre preenche file.type corretamente (o próprio seletor já filtra
  // por accept="image/*"). Mas ao ARRASTAR arquivos direto do Finder/Explorer, alguns
  // navegadores/formatos (ex.: .heic do iPhone, ou certas versões do Windows) entregam
  // file.type vazio — aí o filtro antigo (só file.type.startsWith('image/')) descartava a
  // foto em silêncio, sem nenhum aviso, dando a impressão de que arrastar não fazia nada.
  // Agora, se o tipo não vier preenchido, cai para checar a extensão do arquivo.
  const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|tiff?|heic|heif|avif)$/i;
  function isImageFile(f) {
    return (f.type && f.type.startsWith('image/')) || IMAGE_EXT_RE.test(f.name || '');
  }

  // -------- Upload de fotos do projeto (multi-arquivo, converte para base64 e envia via fetch) --------
  const uploadDrop = document.querySelector('[data-upload-drop]');
  if (uploadDrop) {
    const input = uploadDrop.querySelector('input[type=file]');
    const preview = document.querySelector('#upload-preview');
    const statusEl = document.querySelector('[data-upload-status]');
    const projectId = uploadDrop.dataset.projectId;
    // data-upload-url: pedido em 12/09/2026 pra reaproveitar essa mesma área de arrastar-fotos
    // na aba "Fotos" das Entregas (server/routes/admin.js, deliveryCaseEditPage) sem duplicar
    // esse arquivo inteiro — se não vier esse atributo, mantém o endereço de sempre (projeto).
    const uploadUrl = uploadDrop.dataset.uploadUrl || `/admin/projetos/${projectId}/photos/upload`;

    const openPicker = () => input.click();
    uploadDrop.addEventListener('click', openPicker);
    ['dragover', 'dragenter'].forEach((evt) =>
      uploadDrop.addEventListener(evt, (e) => { e.preventDefault(); uploadDrop.classList.add('dragover'); })
    );
    ['dragleave', 'drop'].forEach((evt) =>
      uploadDrop.addEventListener(evt, (e) => { e.preventDefault(); uploadDrop.classList.remove('dragover'); })
    );
    uploadDrop.addEventListener('drop', (e) => {
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    });
    input.addEventListener('change', () => handleFiles(input.files));

    function fileToDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    async function handleFiles(fileList) {
      const files = Array.from(fileList).filter(isImageFile);
      if (!files.length) {
        if (fileList.length && statusEl) {
          statusEl.textContent = 'Nenhum arquivo de imagem reconhecido (só JPG, PNG, GIF, WEBP, HEIC...). Tente novamente ou use o clique pra selecionar.';
          statusEl.style.color = '#d0503a';
        }
        return;
      }
      preview.innerHTML = '';
      files.forEach((f) => {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        preview.appendChild(img);
      });
      statusEl.textContent = `Enviando ${files.length} foto(s)...`;
      statusEl.style.color = '';

      try {
        const dataUrls = await Promise.all(files.map(fileToDataUrl));
        const res = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photos: dataUrls }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Falha ao enviar fotos.');
        // Corrigido em 30/08/2026: antes essa mensagem usava files.length (quantos arquivos
        // você escolheu), não data.saved (quantos o servidor realmente conseguiu salvar) —
        // por isso podia aparecer "sucesso" mesmo quando nenhuma foto era salva de verdade
        // (ex: token de armazenamento inválido). Agora mostra o número real e avisa se
        // alguma falhou.
        if (data.saved > 0) {
          statusEl.textContent = data.saved === files.length
            ? `${data.saved} foto(s) enviada(s) com sucesso! Atualizando...`
            : `${data.saved} de ${files.length} foto(s) enviada(s). Algumas falharam — tente reenviar.`;
          statusEl.style.color = '';
          setTimeout(() => window.location.reload(), 900);
        } else {
          statusEl.textContent = 'Nenhuma foto foi salva. Pode ser um problema no servidor de armazenamento — avise quem cuida do site.';
          statusEl.style.color = '#d0503a';
        }
      } catch (err) {
        statusEl.textContent = 'Erro: ' + err.message;
        statusEl.style.color = '#d0503a';
      }
    }
  }

  // -------- Upload de vídeo de entrega arrastando o arquivo (além de colar link) --------
  // Pedido do usuário em 17/09/2026: na aba de Vídeos das Entregas, além de colar um link
  // (YouTube/Mega/Drive/etc), poder simplesmente arrastar o arquivo de vídeo direto — mesma ideia
  // do "arraste as fotos" acima, só que um vídeo de cada vez (arquivo de vídeo costuma ser bem
  // maior que foto, então já nasce como upload único em vez de múltiplo).
  const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|mkv)$/i;
  function isVideoFile(f) {
    return (f.type && f.type.startsWith('video/')) || VIDEO_EXT_RE.test(f.name || '');
  }
  const videoUploadDrop = document.querySelector('[data-video-upload-drop]');
  if (videoUploadDrop) {
    const input = videoUploadDrop.querySelector('input[type=file]');
    const statusEl = videoUploadDrop.querySelector('[data-video-upload-status]');
    const uploadUrl = videoUploadDrop.dataset.uploadUrl;

    const openPicker = () => input.click();
    videoUploadDrop.addEventListener('click', openPicker);
    ['dragover', 'dragenter'].forEach((evt) =>
      videoUploadDrop.addEventListener(evt, (e) => { e.preventDefault(); videoUploadDrop.classList.add('dragover'); })
    );
    ['dragleave', 'drop'].forEach((evt) =>
      videoUploadDrop.addEventListener(evt, (e) => { e.preventDefault(); videoUploadDrop.classList.remove('dragover'); })
    );
    videoUploadDrop.addEventListener('drop', (e) => {
      if (e.dataTransfer.files.length) handleVideoFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => { if (input.files.length) handleVideoFile(input.files[0]); });

    async function handleVideoFile(file) {
      if (!isVideoFile(file)) {
        if (statusEl) {
          statusEl.textContent = 'Arquivo não reconhecido como vídeo (use .mp4, .webm ou .mov).';
          statusEl.style.color = '#d0503a';
        }
        return;
      }
      if (statusEl) { statusEl.textContent = 'Enviando vídeo...'; statusEl.style.color = ''; }
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const res = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video: dataUrl }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Falha ao enviar vídeo.');
        if (statusEl) { statusEl.textContent = 'Vídeo enviado com sucesso! Atualizando...'; statusEl.style.color = ''; }
        setTimeout(() => window.location.reload(), 900);
      } catch (err) {
        if (statusEl) { statusEl.textContent = 'Erro: ' + err.message; statusEl.style.color = '#d0503a'; }
      }
    }
  }

  // -------- Upload de fotos da Seleção (igual ao de projeto/entrega, só que manda também o nome
  // original de cada arquivo — é o que aparece na lista de exportação pro Lightroom/Finder/
  // Explorer depois, ver server/routes/admin.js selectionPhotosUpload) --------
  const selectionUploadDrop = document.querySelector('[data-selection-upload-drop]');
  if (selectionUploadDrop) {
    const input = selectionUploadDrop.querySelector('input[type=file]');
    const preview = document.querySelector('#selection-upload-preview');
    const statusEl = document.querySelector('[data-selection-upload-status]');
    const uploadUrl = selectionUploadDrop.dataset.uploadUrl;

    const openPicker = () => input.click();
    selectionUploadDrop.addEventListener('click', openPicker);
    ['dragover', 'dragenter'].forEach((evt) =>
      selectionUploadDrop.addEventListener(evt, (e) => { e.preventDefault(); selectionUploadDrop.classList.add('dragover'); })
    );
    ['dragleave', 'drop'].forEach((evt) =>
      selectionUploadDrop.addEventListener(evt, (e) => { e.preventDefault(); selectionUploadDrop.classList.remove('dragover'); })
    );
    selectionUploadDrop.addEventListener('drop', (e) => {
      if (e.dataTransfer.files.length) handleSelectionFiles(e.dataTransfer.files);
    });
    input.addEventListener('change', () => handleSelectionFiles(input.files));

    function fileToDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    async function handleSelectionFiles(fileList) {
      const files = Array.from(fileList).filter(isImageFile);
      if (!files.length) {
        if (fileList.length && statusEl) {
          statusEl.textContent = 'Nenhum arquivo de imagem reconhecido. Tente novamente ou use o clique pra selecionar.';
          statusEl.style.color = '#d0503a';
        }
        return;
      }
      if (preview) {
        preview.innerHTML = '';
        files.forEach((f) => {
          const img = document.createElement('img');
          img.src = URL.createObjectURL(f);
          preview.appendChild(img);
        });
      }
      statusEl.textContent = `Enviando ${files.length} foto(s)...`;
      statusEl.style.color = '';
      try {
        const photos = await Promise.all(
          files.map(async (f) => ({ data: await fileToDataUrl(f), name: f.name || '' }))
        );
        const res = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photos }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Falha ao enviar fotos.');
        if (data.saved > 0) {
          statusEl.textContent = data.saved === files.length
            ? `${data.saved} foto(s) enviada(s) com sucesso! Atualizando...`
            : `${data.saved} de ${files.length} foto(s) enviada(s). Algumas falharam — tente reenviar.`;
          statusEl.style.color = '';
          setTimeout(() => window.location.reload(), 900);
        } else {
          statusEl.textContent = 'Nenhuma foto foi salva. Pode ser um problema no servidor de armazenamento — avise quem cuida do site.';
          statusEl.style.color = '#d0503a';
        }
      } catch (err) {
        statusEl.textContent = 'Erro: ' + err.message;
        statusEl.style.color = '#d0503a';
      }
    }
  }

  // -------- Modal de exportação da Seleção (abas Lightroom/Finder/Windows + copiar lista de
  // nomes) — ver selectionExportModal em server/routes/admin.js --------
  const exportOpenBtn = document.querySelector('[data-export-modal-open]');
  const exportOverlay = document.querySelector('[data-export-modal-overlay]');
  if (exportOpenBtn && exportOverlay) {
    const closeBtn = exportOverlay.querySelector('[data-export-modal-close]');
    exportOpenBtn.addEventListener('click', () => { exportOverlay.hidden = false; });
    if (closeBtn) closeBtn.addEventListener('click', () => { exportOverlay.hidden = true; });
    exportOverlay.addEventListener('click', (e) => { if (e.target === exportOverlay) exportOverlay.hidden = true; });

    exportOverlay.querySelectorAll('[data-export-tab]').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        const key = tabBtn.dataset.exportTab;
        exportOverlay.querySelectorAll('[data-export-tab]').forEach((b) => b.classList.toggle('active', b === tabBtn));
        exportOverlay.querySelectorAll('[data-export-tab-content]').forEach((c) => {
          c.hidden = c.dataset.exportTabContent !== key;
        });
      });
    });

    exportOverlay.querySelectorAll('[data-export-copy-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const textarea = btn.previousElementSibling;
        if (!textarea) return;
        textarea.select();
        const done = () => {
          const original = btn.textContent;
          btn.textContent = 'Copiado!';
          setTimeout(() => { btn.textContent = original; }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(textarea.value).then(done).catch(() => document.execCommand('copy') && done());
        } else {
          document.execCommand('copy');
          done();
        }
      });
    });
  }

  // -------- Upload de fotos da página Sobre (multi-arquivo, mesmo esquema do upload de projeto) --------
  const bioUploadDrop = document.querySelector('[data-bio-photos-upload]');
  if (bioUploadDrop) {
    const input = bioUploadDrop.querySelector('input[type=file]');
    const preview = document.querySelector('#bio-photos-preview');
    const statusEl = document.querySelector('[data-bio-photos-status]');

    const openPicker = () => input.click();
    bioUploadDrop.addEventListener('click', openPicker);
    ['dragover', 'dragenter'].forEach((evt) =>
      bioUploadDrop.addEventListener(evt, (e) => { e.preventDefault(); bioUploadDrop.classList.add('dragover'); })
    );
    ['dragleave', 'drop'].forEach((evt) =>
      bioUploadDrop.addEventListener(evt, (e) => { e.preventDefault(); bioUploadDrop.classList.remove('dragover'); })
    );
    bioUploadDrop.addEventListener('drop', (e) => {
      if (e.dataTransfer.files.length) handleBioFiles(e.dataTransfer.files);
    });
    input.addEventListener('change', () => handleBioFiles(input.files));

    function fileToDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    async function handleBioFiles(fileList) {
      const files = Array.from(fileList).filter(isImageFile);
      if (!files.length) {
        if (fileList.length && statusEl) {
          statusEl.textContent = 'Nenhum arquivo de imagem reconhecido (só JPG, PNG, GIF, WEBP, HEIC...). Tente novamente ou use o clique pra selecionar.';
          statusEl.style.color = '#d0503a';
        }
        return;
      }
      preview.innerHTML = '';
      files.forEach((f) => {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        preview.appendChild(img);
      });
      statusEl.textContent = `Enviando ${files.length} foto(s)...`;
      statusEl.style.color = '';

      try {
        const dataUrls = await Promise.all(files.map(fileToDataUrl));
        const res = await fetch('/admin/bio/fotos/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photos: dataUrls }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Falha ao enviar fotos.');
        // Mesma correção do upload de fotos de projeto (ver comentário lá em cima):
        // mostra quantas fotos o servidor realmente salvou, não quantas você selecionou.
        if (data.saved > 0) {
          statusEl.textContent = data.saved === files.length
            ? `${data.saved} foto(s) enviada(s) com sucesso! Atualizando...`
            : `${data.saved} de ${files.length} foto(s) enviada(s). Algumas falharam — tente reenviar.`;
          statusEl.style.color = '';
          setTimeout(() => window.location.reload(), 900);
        } else {
          statusEl.textContent = 'Nenhuma foto foi salva. Pode ser um problema no servidor de armazenamento — avise quem cuida do site.';
          statusEl.style.color = '#d0503a';
        }
      } catch (err) {
        statusEl.textContent = 'Erro: ' + err.message;
        statusEl.style.color = '#d0503a';
      }
    }
  }

  // -------- Upload de fotos da galeria "Bastidores" (mesmo esquema das fotos da Sobre) --------
  const bioGalleryDrop = document.querySelector('[data-bio-gallery-upload]');
  if (bioGalleryDrop) {
    const input = bioGalleryDrop.querySelector('input[type=file]');
    const preview = document.querySelector('#bio-gallery-preview');
    const statusEl = document.querySelector('[data-bio-gallery-status]');

    const openPicker = () => input.click();
    bioGalleryDrop.addEventListener('click', openPicker);
    ['dragover', 'dragenter'].forEach((evt) =>
      bioGalleryDrop.addEventListener(evt, (e) => { e.preventDefault(); bioGalleryDrop.classList.add('dragover'); })
    );
    ['dragleave', 'drop'].forEach((evt) =>
      bioGalleryDrop.addEventListener(evt, (e) => { e.preventDefault(); bioGalleryDrop.classList.remove('dragover'); })
    );
    bioGalleryDrop.addEventListener('drop', (e) => {
      if (e.dataTransfer.files.length) handleGalleryFiles(e.dataTransfer.files);
    });
    input.addEventListener('change', () => handleGalleryFiles(input.files));

    function fileToDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    async function handleGalleryFiles(fileList) {
      const files = Array.from(fileList).filter(isImageFile);
      if (!files.length) {
        if (fileList.length && statusEl) {
          statusEl.textContent = 'Nenhum arquivo de imagem reconhecido (só JPG, PNG, GIF, WEBP, HEIC...). Tente novamente ou use o clique pra selecionar.';
          statusEl.style.color = '#d0503a';
        }
        return;
      }
      preview.innerHTML = '';
      files.forEach((f) => {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        preview.appendChild(img);
      });
      statusEl.textContent = `Enviando ${files.length} foto(s)...`;
      statusEl.style.color = '';

      try {
        const dataUrls = await Promise.all(files.map(fileToDataUrl));
        const res = await fetch('/admin/bio/galeria/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photos: dataUrls }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Falha ao enviar fotos.');
        if (data.saved > 0) {
          statusEl.textContent = data.saved === files.length
            ? `${data.saved} foto(s) enviada(s) com sucesso! Atualizando...`
            : `${data.saved} de ${files.length} foto(s) enviada(s). Algumas falharam — tente reenviar.`;
          statusEl.style.color = '';
          setTimeout(() => window.location.reload(), 900);
        } else {
          statusEl.textContent = 'Nenhuma foto foi salva. Pode ser um problema no servidor de armazenamento — avise quem cuida do site.';
          statusEl.style.color = '#d0503a';
        }
      } catch (err) {
        statusEl.textContent = 'Erro: ' + err.message;
        statusEl.style.color = '#d0503a';
      }
    }
  }

  // -------- Upload de fotos de destaque da Home (mesmo esquema das outras galerias) --------
  const heroUploadDrop = document.querySelector('[data-hero-photos-upload]');
  if (heroUploadDrop) {
    const input = heroUploadDrop.querySelector('input[type=file]');
    const preview = document.querySelector('#hero-photos-preview');
    const statusEl = document.querySelector('[data-hero-photos-status]');

    const openPicker = () => input.click();
    heroUploadDrop.addEventListener('click', openPicker);
    ['dragover', 'dragenter'].forEach((evt) =>
      heroUploadDrop.addEventListener(evt, (e) => { e.preventDefault(); heroUploadDrop.classList.add('dragover'); })
    );
    ['dragleave', 'drop'].forEach((evt) =>
      heroUploadDrop.addEventListener(evt, (e) => { e.preventDefault(); heroUploadDrop.classList.remove('dragover'); })
    );
    heroUploadDrop.addEventListener('drop', (e) => {
      if (e.dataTransfer.files.length) handleHeroFiles(e.dataTransfer.files);
    });
    input.addEventListener('change', () => handleHeroFiles(input.files));

    function fileToDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    async function handleHeroFiles(fileList) {
      const files = Array.from(fileList).filter(isImageFile);
      if (!files.length) {
        if (fileList.length && statusEl) {
          statusEl.textContent = 'Nenhum arquivo de imagem reconhecido (só JPG, PNG, GIF, WEBP, HEIC...). Tente novamente ou use o clique pra selecionar.';
          statusEl.style.color = '#d0503a';
        }
        return;
      }
      preview.innerHTML = '';
      files.forEach((f) => {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        preview.appendChild(img);
      });
      statusEl.textContent = `Enviando ${files.length} foto(s)...`;
      statusEl.style.color = '';

      try {
        const dataUrls = await Promise.all(files.map(fileToDataUrl));
        const res = await fetch('/admin/hero/fotos/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photos: dataUrls }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Falha ao enviar fotos.');
        if (data.saved > 0) {
          statusEl.textContent = data.saved === files.length
            ? `${data.saved} foto(s) enviada(s) com sucesso! Atualizando...`
            : `${data.saved} de ${files.length} foto(s) enviada(s). Algumas falharam — tente reenviar.`;
          statusEl.style.color = '';
          setTimeout(() => window.location.reload(), 900);
        } else {
          statusEl.textContent = 'Nenhuma foto foi salva. Pode ser um problema no servidor de armazenamento — avise quem cuida do site.';
          statusEl.style.color = '#d0503a';
        }
      } catch (err) {
        statusEl.textContent = 'Erro: ' + err.message;
        statusEl.style.color = '#d0503a';
      }
    }
  }

  // -------- Upload de foto única (biografia / serviço) --------
  // O campo escondido que recebe a foto (em base64) sempre termina em "_data" no HTML (ver
  // server/routes/admin.js) - antes disso o código pegava "o primeiro input escondido que
  // aparecer", que funcionava só por coincidência de ordem (o campo "_data" sempre vem antes do
  // "_existing" quando os dois existem). Corrigido em 04/09/2026 pra mirar pelo nome, não pela
  // posição - assim uma futura reordenação dos campos no HTML não quebra silenciosamente o
  // upload de foto.
  document.querySelectorAll('[data-single-upload]').forEach((wrapper) => {
    const input = wrapper.querySelector('input[type=file]');
    const hidden = wrapper.querySelector('input[type=hidden][name$="_data"]') || wrapper.querySelector('input[type=hidden]');
    // Aceita tanto <img data-preview> (fotos) quanto <video data-preview> (vídeo de fundo da
    // Home, adicionado em 10/09/2026) — os dois têm .src e funcionam igual aqui.
    const preview = wrapper.querySelector('[data-preview]');
    if (!input) return;
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        hidden.value = reader.result;
        if (preview) { preview.src = reader.result; preview.style.display = 'block'; }
      };
      reader.readAsDataURL(file);
    });
  });

  // Auto-gera slug amigável a partir do título (apenas sugestão, campo continua editável)
  const titleInput = document.querySelector('[data-slug-source]');
  const slugInput = document.querySelector('[data-slug-target]');
  if (titleInput && slugInput) {
    titleInput.addEventListener('blur', () => {
      if (slugInput.value.trim() || slugInput.dataset.locked === 'true') return;
      slugInput.value = titleInput.value
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
    });
  }
})();
