const API_BASE = 'https://wqjzrbhbkienlxocykcn.supabase.co/functions/v1/piscinas-api';

if (localStorage.getItem('logado') !== 'true' || !localStorage.getItem('token')) {
  limparSessao();
  window.location.href = 'login.html';
}

const perfil = localStorage.getItem('perfil') || 'cliente';
let piscinasCache = [];
let clientesCache = [];
let dispositivosPorPiscina = new Map();

function limparSessao() {
  ['token','token_expires_at','usuario','nome_usuario','cliente_id','perfil','logado']
    .forEach(k => localStorage.removeItem(k));
}

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${localStorage.getItem('token') || ''}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    limparSessao();
    window.location.href = 'login.html';
    throw new Error('Sessão expirada');
  }
  return res;
}

function escapeHtml(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setStatus(id, texto, erro = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = texto || '';
  el.classList.toggle('error', erro);
}

function abrirModal(id) {
  if (perfil !== 'admin') return;
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

function fecharModal(modal) {
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  if (!document.querySelector('.modal:not(.hidden)')) document.body.classList.remove('modal-open');
}

function configurarModais() {
  document.querySelectorAll('[data-modal]').forEach(btn => {
    btn.addEventListener('click', () => abrirModal(btn.dataset.modal));
  });

  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => fecharModal(btn.closest('.modal')));
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const aberta = document.querySelector('.modal:not(.hidden)');
      if (aberta) fecharModal(aberta);
    }
  });
}

async function carregarClientes() {
  if (perfil !== 'admin') return;
  const res = await apiFetch('/clientes');
  const dados = await res.json().catch(() => ([]));
  if (!res.ok) throw new Error(dados.erro || 'Erro ao carregar clientes');
  clientesCache = Array.isArray(dados) ? dados : [];
  preencherSelectClientes();
}

function preencherSelectClientes() {
  ['clientePiscina', 'usuarioCliente'].forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;
    const atual = select.value;
    select.innerHTML = '<option value="">Selecione o cliente</option>';
    clientesCache.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.nome;
      select.appendChild(opt);
    });
    if ([...select.options].some(o => o.value === atual)) select.value = atual;
  });
}

async function carregarDispositivos() {
  dispositivosPorPiscina = new Map();
  try {
    const res = await apiFetch('/devices');
    const dados = await res.json().catch(() => ([]));
    if (!res.ok || !Array.isArray(dados)) return;
    dados.forEach(d => {
      if (d.piscina?.id) dispositivosPorPiscina.set(Number(d.piscina.id), d);
    });
  } catch (err) {
    console.error('Erro ao carregar dispositivos:', err);
  }
}

function dispositivoOnline(device) {
  if (!device?.ultimo_ping) return false;
  return Date.now() - new Date(device.ultimo_ping).getTime() < 45000;
}

async function carregarPiscinas() {
  const grid = document.getElementById('piscinasGrid');
  const empty = document.getElementById('emptyPiscinas');
  grid.innerHTML = '<div class="loading-card">Carregando piscinas...</div>';

  try {
    await carregarDispositivos();
    const res = await apiFetch('/piscinas');
    const dados = await res.json().catch(() => ([]));
    if (!res.ok) throw new Error(dados.erro || 'Erro ao carregar piscinas');

    piscinasCache = Array.isArray(dados) ? dados : [];
    renderizarPiscinas();
    preencherSelectPiscinas();
    preencherPiscinasDoUsuario();
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<div class="error-card">${escapeHtml(err.message || 'Erro ao carregar piscinas')}</div>`;
    empty.classList.add('hidden');
  }
}

function renderizarPiscinas() {
  const grid = document.getElementById('piscinasGrid');
  const empty = document.getElementById('emptyPiscinas');
  grid.innerHTML = '';

  if (!piscinasCache.length) {
    empty.classList.remove('hidden');
    document.getElementById('emptyPiscinasTexto').textContent = perfil === 'admin'
      ? 'Cadastre um cliente e depois adicione a piscina.'
      : 'Nenhuma piscina foi vinculada ao seu usuário. Entre em contato com o administrador.';
    return;
  }

  empty.classList.add('hidden');

  piscinasCache.forEach(p => {
    const device = dispositivosPorPiscina.get(Number(p.id));
    const online = dispositivoOnline(device);
    const statusClasse = !device ? 'neutral' : (online ? 'online' : 'offline');
    const statusTexto = !device ? 'Sem controlador' : (online ? 'Online' : 'Offline');
    const motorTexto = device ? (device.estado_motor === 'ligado' ? 'Motor ligado' : 'Motor desligado') : 'ESP32 não vinculado';
    const cliente = perfil === 'admin' && p.clientes?.nome
      ? `<span class="pool-client">${escapeHtml(p.clientes.nome)}</span>` : '';

    const card = document.createElement('article');
    card.className = 'pool-card';
    card.innerHTML = `
      <div class="pool-card-top">
        <div>
          ${cliente}
          <h3>${escapeHtml(p.nome)}</h3>
          <p>${escapeHtml(p.localizacao || 'Localização não informada')}</p>
        </div>
        <span class="status-chip ${statusClasse}">${statusTexto}</span>
      </div>
      <div class="pool-meta">
        <span><strong>Controlador</strong>${device ? escapeHtml(device.device_id) : 'Não vinculado'}</span>
        <span><strong>Motor</strong>${escapeHtml(motorTexto)}</span>
      </div>
      <div class="pool-actions">
        <button class="btn-primary btn-open-pool" type="button" data-open-pool="${Number(p.id)}">Abrir piscina</button>
        ${perfil === 'admin' ? `<button class="btn-danger-light" type="button" data-remove-pool="${Number(p.id)}">Remover</button>` : ''}
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('[data-open-pool]').forEach(btn => {
    btn.addEventListener('click', () => abrirPiscina(Number(btn.dataset.openPool)));
  });

  grid.querySelectorAll('[data-remove-pool]').forEach(btn => {
    btn.addEventListener('click', () => removerPiscina(Number(btn.dataset.removePool)));
  });
}

function preencherSelectPiscinas() {
  const select = document.getElementById('piscinaPareamento');
  if (!select) return;
  const atual = select.value;
  select.innerHTML = '<option value="">Selecione a piscina</option>';
  piscinasCache.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.nome}${p.clientes?.nome ? ' — ' + p.clientes.nome : ''}`;
    select.appendChild(opt);
  });
  if ([...select.options].some(o => o.value === atual)) select.value = atual;
}

function preencherPiscinasDoUsuario() {
  const selectCliente = document.getElementById('usuarioCliente');
  const selectPiscina = document.getElementById('usuarioPiscina');
  if (!selectCliente || !selectPiscina) return;

  const clienteId = Number(selectCliente.value || 0);
  selectPiscina.innerHTML = clienteId
    ? '<option value="">Selecione a piscina</option>'
    : '<option value="">Selecione primeiro o cliente</option>';

  if (!clienteId) return;
  piscinasCache
    .filter(p => Number(p.cliente_id) === clienteId)
    .forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.nome;
      selectPiscina.appendChild(opt);
    });
}

function abrirPiscina(id) {
  window.location.href = `agenda.html?piscina=${encodeURIComponent(id)}`;
}

async function criarCliente() {
  const payload = {
    nome: document.getElementById('clienteNome').value.trim(),
    telefone: document.getElementById('clienteTelefone').value.trim(),
    email: document.getElementById('clienteEmail').value.trim()
  };
  if (!payload.nome) return setStatus('statusCliente', 'Informe o nome do cliente.', true);

  setStatus('statusCliente', 'Cadastrando...');
  try {
    const res = await apiFetch('/clientes', { method: 'POST', body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Erro ao cadastrar cliente');

    ['clienteNome','clienteTelefone','clienteEmail'].forEach(id => document.getElementById(id).value = '');
    await carregarClientes();
    setStatus('statusCliente', 'Cliente cadastrado com sucesso.');
    setTimeout(() => fecharModal(document.getElementById('modalCliente')), 700);
  } catch (err) {
    setStatus('statusCliente', err.message || 'Erro ao cadastrar cliente', true);
  }
}

async function criarPiscina() {
  const payload = {
    cliente_id: Number(document.getElementById('clientePiscina').value || 0),
    nome: document.getElementById('nomePiscinaCadastro').value.trim(),
    localizacao: document.getElementById('localizacaoPiscinaCadastro').value.trim()
  };
  if (!payload.cliente_id) return setStatus('statusPiscina', 'Selecione o cliente.', true);
  if (!payload.nome) return setStatus('statusPiscina', 'Informe o nome da piscina.', true);

  setStatus('statusPiscina', 'Cadastrando...');
  try {
    const res = await apiFetch('/piscinas', { method: 'POST', body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Erro ao cadastrar piscina');

    document.getElementById('nomePiscinaCadastro').value = '';
    document.getElementById('localizacaoPiscinaCadastro').value = '';
    await carregarPiscinas();
    setStatus('statusPiscina', 'Piscina cadastrada com sucesso.');
    setTimeout(() => fecharModal(document.getElementById('modalPiscina')), 700);
  } catch (err) {
    setStatus('statusPiscina', err.message || 'Erro ao cadastrar piscina', true);
  }
}

async function criarUsuario() {
  const payload = {
    cliente_id: Number(document.getElementById('usuarioCliente').value || 0),
    piscina_id: Number(document.getElementById('usuarioPiscina').value || 0),
    nome: document.getElementById('usuarioNome').value.trim(),
    usuario: document.getElementById('usuarioLogin').value.trim(),
    senha: document.getElementById('usuarioSenha').value
  };

  if (!payload.cliente_id || !payload.piscina_id || !payload.nome || !payload.usuario || !payload.senha) {
    return setStatus('statusUsuario', 'Preencha cliente, piscina, nome, usuário e senha.', true);
  }

  setStatus('statusUsuario', 'Criando acesso...');
  try {
    const res = await apiFetch('/usuarios', { method: 'POST', body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Erro ao cadastrar usuário');

    ['usuarioNome','usuarioLogin','usuarioSenha'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('usuarioCliente').value = '';
    preencherPiscinasDoUsuario();
    setStatus('statusUsuario', 'Usuário criado e vinculado à piscina.');
    setTimeout(() => fecharModal(document.getElementById('modalUsuario')), 800);
  } catch (err) {
    setStatus('statusUsuario', err.message || 'Erro ao cadastrar usuário', true);
  }
}

async function parearDispositivo() {
  const piscinaId = Number(document.getElementById('piscinaPareamento').value || 0);
  const codigo = document.getElementById('codigoPareamento').value.trim();
  if (!piscinaId) return setStatus('statusPareamento', 'Selecione a piscina.', true);
  if (!/^\d{6}$/.test(codigo)) return setStatus('statusPareamento', 'Informe o código de 6 dígitos.', true);

  setStatus('statusPareamento', 'Vinculando...');
  try {
    const res = await apiFetch('/devices/pair', {
      method: 'POST',
      body: JSON.stringify({ piscina_id: piscinaId, pairing_code: codigo })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Falha no pareamento');

    document.getElementById('codigoPareamento').value = '';
    await carregarPiscinas();
    setStatus('statusPareamento', `Controlador ${data.device_id} vinculado.`);
    setTimeout(() => fecharModal(document.getElementById('modalParear')), 900);
  } catch (err) {
    setStatus('statusPareamento', err.message || 'Falha no pareamento', true);
  }
}

async function removerPiscina(id) {
  const piscina = piscinasCache.find(p => Number(p.id) === Number(id));
  if (!confirm(`Remover ${piscina?.nome || 'esta piscina'} e sua agenda?`)) return;

  try {
    const res = await apiFetch(`/piscinas/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Erro ao remover piscina');
    await carregarPiscinas();
  } catch (err) {
    alert(err.message || 'Erro ao remover piscina');
  }
}

async function logout() {
  try { await apiFetch('/logout', { method: 'POST' }); } catch (_) {}
  limparSessao();
  window.location.href = 'login.html';
}

function configurarPerfil() {
  const nome = localStorage.getItem('nome_usuario') || localStorage.getItem('usuario') || 'Usuário';
  document.getElementById('userDisplay').textContent = nome;
  document.getElementById('perfilDisplay').textContent = perfil === 'admin' ? 'Administrador' : 'Cliente';

  if (perfil === 'admin') {
    document.getElementById('adminActions').classList.remove('hidden');
    document.getElementById('painelTipo').textContent = 'ADMINISTRAÇÃO';
    document.getElementById('painelTitulo').textContent = 'Painel de controle';
    document.getElementById('painelDescricao').textContent = 'Gerencie clientes, usuários, piscinas e controladores em um único lugar.';
    document.getElementById('piscinasTitulo').textContent = 'Piscinas cadastradas';
  } else {
    document.getElementById('painelTipo').textContent = 'MINHA CONTA';
    document.getElementById('painelTitulo').textContent = 'Minha piscina';
    document.getElementById('painelDescricao').textContent = 'Acesse sua piscina para controlar o motor e acompanhar agenda, consumo e qualidade da água.';
    document.getElementById('piscinasTitulo').textContent = 'Piscina vinculada ao seu acesso';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  configurarPerfil();
  configurarModais();
  document.getElementById('btnSair').addEventListener('click', logout);
  document.getElementById('btnAtualizar').addEventListener('click', carregarPiscinas);

  if (perfil === 'admin') {
    document.getElementById('btnCriarCliente').addEventListener('click', criarCliente);
    document.getElementById('btnCriarPiscina').addEventListener('click', criarPiscina);
    document.getElementById('btnCriarUsuario').addEventListener('click', criarUsuario);
    document.getElementById('btnParear').addEventListener('click', parearDispositivo);
    document.getElementById('usuarioCliente').addEventListener('change', preencherPiscinasDoUsuario);

    try { await carregarClientes(); }
    catch (err) { console.error(err); }
  }

  await carregarPiscinas();
});
