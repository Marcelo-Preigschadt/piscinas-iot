const API = 'https://wqjzrbhbkienlxocykcn.supabase.co/functions/v1/piscinas-api';

if (localStorage.getItem('logado') !== 'true' || !localStorage.getItem('token')) {
  sair();
}

let piscinaSelecionada = null;
let timerStatus = null;

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${localStorage.getItem('token') || ''}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const res = await fetch(`${API}${path}`, { ...options, headers });
  if (res.status === 401) {
    sair();
    throw new Error('Sessão expirada');
  }
  return res;
}

function sair() {
  ['token','token_expires_at','usuario','nome_usuario','cliente_id','perfil','logado'].forEach(k => localStorage.removeItem(k));
  window.location.href = 'login.html';
}

async function carregarPiscinas() {
  try {
    const res = await apiFetch('/piscinas');
    const piscinas = await res.json();
    if (!res.ok) throw new Error(piscinas.erro || 'Erro ao carregar piscinas');

    const container = document.getElementById('piscinasCards');
    container.innerHTML = '';

    piscinas.forEach(p => {
      const card = document.createElement('div');
      card.className = 'card-piscina';
      const cliente = p.clientes?.nome ? `<br><small>${p.clientes.nome}</small>` : '';
      card.innerHTML = `<strong>${p.nome}</strong><br>${p.localizacao || 'Sem localização'}${cliente}`;
      card.onclick = () => abrirAgenda(p);
      container.appendChild(card);
    });
  } catch (err) {
    console.error(err);
    alert(err.message || 'Erro ao carregar piscinas');
  }
}

function abrirAgenda(piscina) {
  piscinaSelecionada = piscina;
  document.getElementById('listaPiscinasAgenda').classList.add('hidden');
  document.getElementById('agendaPiscina').classList.remove('hidden');
  document.getElementById('nomePiscina').innerText = piscina.nome;

  carregarAgenda();
  carregarStatusMotor();
  if (timerStatus) clearInterval(timerStatus);
  timerStatus = setInterval(carregarStatusMotor, 5000);
}

function voltar() {
  if (!document.getElementById('agendaPiscina').classList.contains('hidden')) {
    document.getElementById('agendaPiscina').classList.add('hidden');
    document.getElementById('listaPiscinasAgenda').classList.remove('hidden');
    piscinaSelecionada = null;
    if (timerStatus) clearInterval(timerStatus);
    timerStatus = null;
  } else {
    window.location.href = 'index.html';
  }
}

async function carregarAgenda() {
  if (!piscinaSelecionada) return;
  try {
    const res = await apiFetch(`/agenda/${piscinaSelecionada.id}`);
    const dados = await res.json();
    if (!res.ok) throw new Error(dados.erro || 'Erro ao carregar agenda');

    const tbody = document.querySelector('#lista-agenda tbody');
    tbody.innerHTML = '';

    dados.forEach(a => {
      tbody.innerHTML += `
        <tr>
          <td>${diaTexto(a.dia_semana)}</td>
          <td>${String(a.hora_inicio).slice(0,5)}</td>
          <td>${a.duracao_min} min</td>
          <td><button onclick="remover(${a.id})">Excluir</button></td>
        </tr>
      `;
    });
  } catch (err) {
    console.error(err);
    alert(err.message || 'Erro ao carregar agenda');
  }
}

document.getElementById('formAgenda').addEventListener('submit', async e => {
  e.preventDefault();
  if (!piscinaSelecionada) return;

  try {
    const res = await apiFetch('/agenda', {
      method: 'POST',
      body: JSON.stringify({
        piscina_id: piscinaSelecionada.id,
        dia_semana: Number(document.getElementById('dia').value),
        hora_inicio: document.getElementById('hora').value,
        duracao_min: Number(document.getElementById('duracao').value)
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Erro ao adicionar horário');
    await carregarAgenda();
  } catch (err) {
    console.error(err);
    alert(err.message || 'Erro ao adicionar horário');
  }
});

async function remover(id) {
  try {
    const res = await apiFetch(`/agenda/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Erro ao excluir horário');
    await carregarAgenda();
  } catch (err) {
    console.error(err);
    alert(err.message || 'Erro ao excluir horário');
  }
}

function diaTexto(d) {
  return ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][Number(d)];
}

async function carregarStatusMotor() {
  if (!piscinaSelecionada) return;
  const el = document.getElementById('statusMotor');
  try {
    const res = await apiFetch(`/motor/${piscinaSelecionada.id}/status`);
    const data = await res.json().catch(() => ({}));

    if (res.status === 404) {
      el.innerText = 'SEM CONTROLADOR';
      el.classList.remove('ligado', 'desligado');
      return;
    }
    if (!res.ok) throw new Error(data.erro || 'Falha ao obter status');

    if (data.status === 'offline') {
      el.innerText = 'OFFLINE';
      el.classList.remove('ligado');
      el.classList.add('desligado');
      return;
    }

    const ligado = data.motor === 'ligado';
    el.innerText = ligado ? 'LIGADO' : 'DESLIGADO';
    el.classList.toggle('ligado', ligado);
    el.classList.toggle('desligado', !ligado);
  } catch (err) {
    console.error(err);
    el.innerText = 'ERRO';
  }
}

async function enviarComando(acao) {
  if (!piscinaSelecionada) return alert('Selecione uma piscina primeiro');
  const el = document.getElementById('statusMotor');

  try {
    const res = await apiFetch(`/motor/${piscinaSelecionada.id}/${acao}`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || `Falha ao ${acao} o motor`);

    el.innerText = data.dispositivo === 'offline' ? 'COMANDO PENDENTE / OFFLINE' : 'AGUARDANDO ESP32...';
    setTimeout(carregarStatusMotor, 5500);
  } catch (err) {
    console.error(err);
    alert(err.message || 'Erro na comunicação com o servidor');
  }
}

function ligarMotor() {
  return enviarComando('ligar');
}

function desligarMotor() {
  return enviarComando('desligar');
}

carregarPiscinas();
