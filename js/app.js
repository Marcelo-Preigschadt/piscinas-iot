const API_BASE = 'https://wqjzrbhbkienlxocykcn.supabase.co/functions/v1/piscinas-api';

const token = localStorage.getItem('token');
if (localStorage.getItem('logado') !== 'true' || !token) {
  limparSessao();
  window.location.href = 'login.html';
}

function limparSessao() {
  ['token','token_expires_at','usuario','nome_usuario','cliente_id','perfil','logado'].forEach(k => localStorage.removeItem(k));
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
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

let piscinasCache = [];
let clientesCache = [];
let dispositivosPorPiscina = new Map();

async function carregarDispositivos() {
  try {
    const res = await apiFetch('/devices');
    const dados = await res.json();
    dispositivosPorPiscina = new Map();
    if (res.ok && Array.isArray(dados)) {
      dados.forEach(d => {
        if (d.piscina?.id) dispositivosPorPiscina.set(Number(d.piscina.id), d);
      });
    }
  } catch (err) {
    console.error('Erro ao carregar dispositivos:', err);
  }
}

async function carregarPiscinas() {
  try {
    await carregarDispositivos();
    const res = await apiFetch('/piscinas');
    const piscinas = await res.json();
    if (!res.ok) throw new Error(piscinas.erro || 'Erro ao carregar piscinas');

    piscinasCache = Array.isArray(piscinas) ? piscinas : [];
    const lista = document.getElementById('listaPiscinas');
    const selectPareamento = document.getElementById('piscinaPareamento');
    lista.innerHTML = '';
    selectPareamento.innerHTML = '<option value="">Selecione a piscina</option>';

    piscinasCache.forEach(p => {
      const device = dispositivosPorPiscina.get(Number(p.id));
      const clienteNome = p.clientes?.nome ? ` • ${escapeHtml(p.clientes.nome)}` : '';
      const deviceInfo = device
        ? ` • ${escapeHtml(device.device_id)} • ${device.status || 'offline'} • motor ${device.estado_motor || 'desligado'}`
        : ' • sem controlador';

      const li = document.createElement('li');
      li.innerHTML = `
        <span>${escapeHtml(p.nome)} - ${escapeHtml(p.localizacao || 'Sem localização')}${clienteNome}${deviceInfo}</span>
        <button onclick="removerPiscina(${Number(p.id)})">Remover</button>
      `;
      lista.appendChild(li);

      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.nome}${p.clientes?.nome ? ' - ' + p.clientes.nome : ''}`;
      selectPareamento.appendChild(opt);
    });
  } catch (err) {
    console.error(err);
    alert(err.message || 'Erro ao carregar piscinas');
  }
}

async function criarPiscina() {
  const nome = document.getElementById('nome').value.trim();
  const localizacao = document.getElementById('localizacao').value.trim();
  if (!nome) return alert('Informe o nome da piscina');

  const payload = { nome, localizacao };
  if (localStorage.getItem('perfil') === 'admin') {
    const clienteId = document.getElementById('clientePiscina').value;
    if (!clienteId) return alert('Selecione o cliente');
    payload.cliente_id = Number(clienteId);
  }

  try {
    const res = await apiFetch('/piscinas', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Erro ao criar piscina');

    document.getElementById('nome').value = '';
    document.getElementById('localizacao').value = '';
    await carregarPiscinas();
  } catch (err) {
    console.error(err);
    alert(err.message || 'Erro ao criar piscina');
  }
}

async function removerPiscina(id) {
  if (!confirm('Remover esta piscina e sua agenda?')) return;
  try {
    const res = await apiFetch(`/piscinas/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Erro ao remover piscina');
    await carregarPiscinas();
  } catch (err) {
    console.error(err);
    alert(err.message || 'Erro ao remover piscina');
  }
}

async function parearDispositivo() {
  const piscinaId = document.getElementById('piscinaPareamento').value;
  const codigo = document.getElementById('codigoPareamento').value.trim();
  const status = document.getElementById('statusPareamento');

  if (!piscinaId) return alert('Selecione a piscina');
  if (!/^\d{6}$/.test(codigo)) return alert('Informe o código de pareamento de 6 dígitos');

  status.textContent = 'Vinculando...';
  try {
    const res = await apiFetch('/devices/pair', {
      method: 'POST',
      body: JSON.stringify({ piscina_id: Number(piscinaId), pairing_code: codigo })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Falha no pareamento');
    status.textContent = `Controlador ${data.device_id} vinculado com sucesso.`;
    document.getElementById('codigoPareamento').value = '';
    await carregarPiscinas();
  } catch (err) {
    console.error(err);
    status.textContent = err.message || 'Falha no pareamento';
  }
}

async function carregarClientes() {
  if (localStorage.getItem('perfil') !== 'admin') return;

  const res = await apiFetch('/clientes');
  const clientes = await res.json();
  if (!res.ok) throw new Error(clientes.erro || 'Erro ao carregar clientes');

  clientesCache = Array.isArray(clientes) ? clientes : [];
  const lista = document.getElementById('listaClientes');
  const select = document.getElementById('clientePiscina');
  lista.innerHTML = '';
  select.innerHTML = '<option value="">Selecione o cliente</option>';

  clientesCache.forEach(c => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(c.nome)}${c.email ? ' • ' + escapeHtml(c.email) : ''}${c.telefone ? ' • ' + escapeHtml(c.telefone) : ''}</span>`;
    lista.appendChild(li);

    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.nome;
    select.appendChild(opt);
  });
}

async function criarCliente() {
  const payload = {
    nome: document.getElementById('clienteNome').value.trim(),
    telefone: document.getElementById('clienteTelefone').value.trim(),
    email: document.getElementById('clienteEmail').value.trim(),
    nome_usuario: document.getElementById('clienteUsuarioNome').value.trim(),
    usuario: document.getElementById('clienteUsuario').value.trim(),
    senha: document.getElementById('clienteSenha').value
  };

  if (!payload.nome || !payload.nome_usuario || !payload.usuario || !payload.senha) {
    return alert('Informe cliente, responsável, usuário e senha inicial');
  }

  try {
    const res = await apiFetch('/clientes', { method: 'POST', body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Erro ao cadastrar cliente');

    ['clienteNome','clienteTelefone','clienteEmail','clienteUsuarioNome','clienteUsuario','clienteSenha']
      .forEach(id => document.getElementById(id).value = '');
    await carregarClientes();
    alert('Cliente cadastrado. O usuário já pode entrar no sistema.');
  } catch (err) {
    console.error(err);
    alert(err.message || 'Erro ao cadastrar cliente');
  }
}

function logout() {
  limparSessao();
  window.location.href = 'login.html';
}

function abrirAgenda() {
  window.location.href = 'agenda.html';
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('btnSair').addEventListener('click', logout);
  document.getElementById('btnAgenda').addEventListener('click', abrirAgenda);
  document.getElementById('btnCriar').addEventListener('click', criarPiscina);
  document.getElementById('btnParear').addEventListener('click', parearDispositivo);

  const nome = localStorage.getItem('nome_usuario') || localStorage.getItem('usuario');
  const perfil = localStorage.getItem('perfil');
  if (nome) document.getElementById('userDisplay').innerText = `Bem-vindo, ${nome}`;

  if (perfil === 'admin') {
    document.getElementById('adminClientes').classList.remove('hidden');
    document.getElementById('adminClienteContainer').classList.remove('hidden');
    document.getElementById('btnCriarCliente').addEventListener('click', criarCliente);
    try { await carregarClientes(); } catch (err) { console.error(err); alert(err.message); }
  }

  await carregarPiscinas();
});
