const ACCESS_API_BASE = 'https://wqjzrbhbkienlxocykcn.supabase.co/functions/v1/piscinas-acessos';

async function accessFetch(path, options = {}) {
  return fetchAuth(ACCESS_API_BASE, path, options);
}

function instalarSeletorPerfil() {
  if (perfil !== 'admin') return;
  const modalBody = document.querySelector('#modalCliente .modal-body');
  const ajuda = modalBody?.querySelector('.form-help');
  if (!modalBody || !ajuda || document.getElementById('clientePerfilSelector')) return;

  const bloco = document.createElement('div');
  bloco.id = 'clientePerfilSelector';
  bloco.className = 'access-level-block';
  bloco.innerHTML = `
    <div class="access-level-title">
      <span>Nível de acesso</span>
      <small>Defina o que este usuário poderá administrar no sistema.</small>
    </div>
    <div class="access-level-grid">
      <label class="access-level-option">
        <input type="radio" name="clientePerfil" value="cliente" checked>
        <span class="access-level-card">
          <span class="access-level-tag">CLIENTE</span>
          <strong>Acesso à própria piscina</strong>
          <small>Visualiza e opera somente a piscina vinculada ao seu cadastro.</small>
        </span>
      </label>
      <label class="access-level-option">
        <input type="radio" name="clientePerfil" value="admin">
        <span class="access-level-card access-admin-card">
          <span class="access-level-tag">ADMINISTRADOR</span>
          <strong>Acesso administrativo</strong>
          <small>Gerencia clientes, piscinas, equipamentos, agendas e controladores.</small>
        </span>
      </label>
    </div>`;
  ajuda.before(bloco);

  const style = document.createElement('style');
  style.textContent = `
    .access-level-block{display:grid;gap:9px;margin-top:1px}
    .access-level-title{display:grid;gap:3px}
    .access-level-title>span{font-size:11px;font-weight:850;color:#35566a}
    .access-level-title>small{font-size:10px;font-weight:500;color:#71828d;line-height:1.4}
    .access-level-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .access-level-option{display:block!important;cursor:pointer}
    .access-level-option input{position:absolute;opacity:0;pointer-events:none;width:1px!important;height:1px!important;min-height:0!important}
    .access-level-card{min-height:112px;border:1px solid #d3e1e8;border-radius:12px;padding:13px;display:flex;flex-direction:column;gap:5px;background:#fff;transition:.16s ease;box-shadow:0 3px 10px rgba(8,48,70,.025)}
    .access-level-card:hover{border-color:#8ccfe6;background:#fafdff}
    .access-level-tag{font-size:8px;letter-spacing:.12em;font-weight:900;color:#0088b7}
    .access-level-card strong{font-size:13px;color:#173e54}
    .access-level-card small{font-size:10px!important;font-weight:500!important;color:#6d7f8a;line-height:1.4}
    .access-level-option input:checked + .access-level-card{border-color:#079ed0;background:#effaff;box-shadow:0 0 0 3px rgba(6,185,239,.10)}
    .access-level-option input:checked + .access-admin-card{border-color:#0c6f9c;background:#edf7fb}
    .access-level-option input:focus-visible + .access-level-card{outline:3px solid rgba(6,185,239,.22);outline-offset:2px}
    .client-role{display:inline-flex;align-items:center;width:max-content;border-radius:999px;padding:4px 7px;margin-top:6px;font-size:8px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;background:#edf3f6;color:#5f707a}
    .client-role.admin{background:#e6f5fb;color:#096a91}
    @media(max-width:700px){.access-level-grid{grid-template-columns:1fr}.access-level-card{min-height:auto}}
  `;
  document.head.appendChild(style);
}

carregarClientes = async function() {
  if (perfil !== 'admin') return;
  const grid = document.getElementById('clientesGrid');
  if (grid) grid.innerHTML = '<div class="loading-card">Carregando clientes...</div>';
  try {
    const res = await accessFetch('/clientes');
    const dados = await res.json().catch(() => []);
    if (!res.ok) throw new Error(dados.erro || 'Erro ao carregar clientes');
    clientesCache = Array.isArray(dados) ? dados : [];
    renderizarClientes();
    preencherSelectClientes();
  } catch (err) {
    console.error(err);
    if (grid) grid.innerHTML = `<div class="error-card">${escapeHtml(err.message || 'Erro ao carregar clientes')}</div>`;
  }
};

renderizarClientes = function() {
  const grid = document.getElementById('clientesGrid');
  const empty = document.getElementById('emptyClientes');
  if (!grid || !empty) return;
  grid.innerHTML = '';

  if (!clientesCache.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  clientesCache.forEach(c => {
    const usuario = Array.isArray(c.usuarios) && c.usuarios.length ? c.usuarios[0] : null;
    const piscinaUsuario = usuario?.piscina_id ? (c.piscinas || []).find(p => Number(p.id) === Number(usuario.piscina_id)) : null;
    const piscina = piscinaUsuario || ((c.piscinas || []).length ? c.piscinas[0] : null);
    const acessoStatus = usuario ? (usuario.primeiro_acesso ? 'Senha provisória' : 'Acesso ativo') : 'Sem usuário';
    const acessoClasse = usuario?.primeiro_acesso ? 'warning' : (usuario ? 'success' : 'neutral');
    const perfilUsuario = usuario?.perfil === 'admin' ? 'Administrador' : 'Cliente';

    const card = document.createElement('article');
    card.className = 'client-card';
    card.innerHTML = `
      <div class="client-card-top">
        <div>
          <span class="eyebrow">CLIENTE</span>
          <h3>${escapeHtml(c.nome)}</h3>
          <p>${escapeHtml(c.email || 'E-mail não informado')}${c.telefone ? ' • ' + escapeHtml(c.telefone) : ''}</p>
          ${usuario ? `<span class="client-role ${usuario.perfil === 'admin' ? 'admin' : ''}">${perfilUsuario}</span>` : ''}
        </div>
        <span class="status-chip ${acessoClasse}">${acessoStatus}</span>
      </div>
      <div class="client-info-grid">
        <div><span>Usuário de acesso</span><strong>${usuario ? escapeHtml(usuario.usuario) : 'Não cadastrado'}</strong></div>
        <div><span>Piscina vinculada</span><strong>${piscina ? escapeHtml(piscina.nome) : 'Nenhuma piscina'}</strong></div>
      </div>
      <div class="client-actions">
        <button class="btn-secondary" type="button" data-link-client="${Number(c.id)}">${piscina ? 'Alterar piscina vinculada' : 'Vincular piscina'}</button>
        ${usuario ? `<button class="btn-danger-light" type="button" data-delete-user="${Number(usuario.id)}" data-user-name="${escapeHtml(usuario.usuario)}">Excluir usuário</button>` : ''}
      </div>`;
    grid.appendChild(card);
  });

  grid.querySelectorAll('[data-link-client]').forEach(btn => btn.addEventListener('click', () => {
    const clienteId = String(btn.dataset.linkClient);
    const select = document.getElementById('clienteVinculo');
    if (select) select.value = clienteId;
    const cliente = clientesCache.find(c => Number(c.id) === Number(clienteId));
    const usuario = cliente?.usuarios?.[0];
    const piscinaSelect = document.getElementById('piscinaVinculo');
    if (piscinaSelect && usuario?.piscina_id) piscinaSelect.value = String(usuario.piscina_id);
    abrirModal('modalVinculo');
  }));

  grid.querySelectorAll('[data-delete-user]').forEach(btn => btn.addEventListener('click', () => excluirUsuario(Number(btn.dataset.deleteUser), btn.dataset.userName)));
};

criarCliente = async function() {
  const perfilSelecionado = document.querySelector('input[name="clientePerfil"]:checked')?.value === 'admin' ? 'admin' : 'cliente';
  const payload = {
    nome: document.getElementById('clienteNome').value.trim(),
    telefone: document.getElementById('clienteTelefone').value.trim(),
    email: document.getElementById('clienteEmail').value.trim(),
    usuario: document.getElementById('clienteUsuario').value.trim(),
    senha_provisoria: document.getElementById('clienteSenhaProvisoria').value,
    perfil: perfilSelecionado,
  };

  if (!payload.nome || !payload.usuario || !payload.senha_provisoria) return setStatus('statusCliente', 'Informe nome, usuário e senha provisória.', true);
  if (payload.senha_provisoria.length < 6) return setStatus('statusCliente', 'A senha provisória deve ter pelo menos 6 caracteres.', true);

  setStatus('statusCliente', 'Cadastrando...');
  try {
    const res = await accessFetch('/clientes', { method: 'POST', body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Erro ao cadastrar cliente');

    ['clienteNome','clienteTelefone','clienteEmail','clienteUsuario','clienteSenhaProvisoria'].forEach(id => document.getElementById(id).value = '');
    const padrao = document.querySelector('input[name="clientePerfil"][value="cliente"]');
    if (padrao) padrao.checked = true;

    await carregarClientes();
    setStatus('statusCliente', perfilSelecionado === 'admin' ? 'Cliente cadastrado com acesso administrativo provisório.' : 'Cliente cadastrado com acesso provisório.');
    setTimeout(() => fecharModal(document.getElementById('modalCliente')), 1000);
  } catch (err) {
    setStatus('statusCliente', err.message || 'Erro ao cadastrar cliente', true);
  }
};

excluirUsuario = async function(id, usuario) {
  if (!confirm(`Excluir o usuário ${usuario || ''}? O cliente e a piscina permanecerão cadastrados.`)) return;
  try {
    const res = await accessFetch(`/usuarios/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Erro ao excluir usuário');
    await carregarClientes();
  } catch (err) {
    alert(err.message || 'Erro ao excluir usuário');
  }
};

instalarSeletorPerfil();
