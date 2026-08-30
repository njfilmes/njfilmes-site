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

  // -------- Upload de fotos do projeto (multi-arquivo, converte para base64 e envia via fetch) --------
  const uploadDrop = document.querySelector('[data-upload-drop]');
  if (uploadDrop) {
    const input = uploadDrop.querySelector('input[type=file]');
    const preview = document.querySelector('#upload-preview');
    const statusEl = document.querySelector('[data-upload-status]');
    const projectId = uploadDrop.dataset.projectId;

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
      const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
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
        const res = await fetch(`/admin/projetos/${projectId}/photos/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photos: dataUrls }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Falha ao enviar fotos.');
        statusEl.textContent = `${files.length} foto(s) enviada(s) com sucesso! Atualizando...`;
        setTimeout(() => window.location.reload(), 600);
      } catch (err) {
        statusEl.textContent = 'Erro: ' + err.message;
        statusEl.style.color = '#d0503a';
      }
    }
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
      const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
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
        statusEl.textContent = `${files.length} foto(s) enviada(s) com sucesso! Atualizando...`;
        setTimeout(() => window.location.reload(), 600);
      } catch (err) {
        statusEl.textContent = 'Erro: ' + err.message;
        statusEl.style.color = '#d0503a';
      }
    }
  }

  // -------- Upload de foto única (biografia / serviço) --------
  document.querySelectorAll('[data-single-upload]').forEach((wrapper) => {
    const input = wrapper.querySelector('input[type=file]');
    const hidden = wrapper.querySelector('input[type=hidden]');
    const preview = wrapper.querySelector('img[data-preview]');
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
