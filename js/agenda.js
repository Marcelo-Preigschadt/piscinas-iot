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

function escapeHtml(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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
      const cliente = p.clientes?.nome ? `<br><small>${escapeHtml(p.clientes.nome)}</small>` : '';
      card.innerHTML = `<strong>${escapeHtml(p.nome)}</strong><br>${escapeHtml(p.localizacao || 'Sem localização')}${cliente}`;
      card.onclick = () => abrirAgenda(p);
      container.appendChild(card);
    });
  } catch (err) {
    console.error(err);
    alert(err.message || 'Erro ao carregar piscinas');
  }
}

function abrirAgenda(piscina) {
  piscinaSelecionada = { ...piscina };
  document.getElementById('listaPiscinasAgenda').classList.add('hidden');
  document.getElementById('agendaPiscina').classList.remove('hidden');
  document.getElementById('nomePiscina').innerText = piscina.nome;

  preencherDadosMotor(piscinaSelecionada);
  carregarAgenda();
  carregarPainelIoT();

  if (timerStatus) clearInterval(timerStatus);
  timerStatus = setInterval(carregarPainelIoT, 5000);
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

function preencherDadosMotor(p) {
  document.getElementById('motorFabricante').value = p.motor_fabricante ?? '';
  document.getElementById('motorModelo').value = p.motor_modelo ?? '';
  document.getElementById('motorPotenciaCv').value = p.motor_potencia_cv ?? '';
  document.getElementById('motorTensaoV').value = p.motor_tensao_v ?? '';
  document.getElementById('motorCorrenteNominal').value = p.motor_corrente_nominal_a ?? '';
  document.getElementById('motorObservacoes').value = p.motor_observacoes ?? '';
}

function numeroOuNull(id) {
  const valor = document.getElementById(id).value.trim();
  if (valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

async function salvarDadosMotor() {
  if (!piscinaSelecionada) return;

  const status = document.getElementById('statusSalvarMotor');
  status.textContent = 'Salvando...';

  const payload = {
    motor_fabricante: document.getElementById('motorFabricante').value.trim(),
    motor_modelo: document.getElementById('motorModelo').value.trim(),
    motor_potencia_cv: numeroOuNull('motorPotenciaCv'),
    motor_tensao_v: numeroOuNull('motorTensaoV'),
    motor_corrente_nominal_a: numeroOuNull('motorCorrenteNominal'),
    motor_observacoes: document.getElementById('motorObservacoes').value.trim()
  };

  try {
    const res = await apiFetch(`/piscinas/${piscinaSelecionada.id}/motor`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Erro ao salvar dados do motor');

    Object.assign(piscinaSelecionada, data);
    preencherDadosMotor(piscinaSelecionada);
    status.textContent = 'Dados salvos';
    setTimeout(() => { status.textContent = ''; }, 2500);
  } catch (err) {
    console.error(err);
    status.textContent = err.message || 'Erro ao salvar';
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

function mostrarValor(id, valor, casas, unidade, aguardando = 'Aguardando leitura') {
  const el = document.getElementById(id);
  if (valor === null || valor === undefined || valor === '') {
    el.innerText = aguardando;
    return;
  }
  const numero = Number(valor);
  if (!Number.isFinite(numero)) {
    el.innerText = aguardando;
    return;
  }
  el.innerText = `${numero.toFixed(casas)}${unidade ? ' ' + unidade : ''}`;
}

function limparTelemetria(texto = 'Aguardando leitura') {
  document.getElementById('leituraCorrente').innerText = texto;
  document.getElementById('leituraPotencia').innerText = texto;
  document.getElementById('leituraEnergia').innerText = texto;
  document.getElementById('leituraPh').innerText = 'Aguardando sensor';
  document.getElementById('leituraTemperatura').innerText = 'Aguardando sensor';
  document.getElementById('leituraOrp').innerText = 'Aguardando sensor';
  document.getElementById('ultimaLeitura').innerText = 'Nenhuma leitura recebida';
}

function atualizarStatusMotor(status, motor) {
  const el = document.getElementById('statusMotor');
  el.classList.remove('ligado', 'desligado');

  if (status === 'sem_controlador') {
    el.innerText = 'SEM CONTROLADOR';
    return;
  }

  if (status === 'offline') {
    el.innerText = 'OFFLINE';
    el.classList.add('desligado');
    return;
  }

  const ligado = motor === 'ligado';
  el.innerText = ligado ? 'LIGADO' : 'DESLIGADO';
  el.classList.add(ligado ? 'ligado' : 'desligado');
}

async function carregarPainelIoT() {
  if (!piscinaSelecionada) return;

  try {
    const res = await apiFetch(`/telemetria/${piscinaSelecionada.id}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Erro ao carregar telemetria');

    const deviceLine = document.getElementById('deviceStatusLine');

    if (!data.conectado) {
      deviceLine.innerText = 'Controlador: não vinculado';
      atualizarStatusMotor('sem_controlador', null);
      limparTelemetria('Sem controlador');
      return;
    }

    deviceLine.innerText = `Controlador: ${data.device_id} • ${data.status === 'online' ? 'ONLINE' : 'OFFLINE'}`;
    atualizarStatusMotor(data.status, data.motor);

    const l = data.leitura || {};
    mostrarValor('leituraCorrente', l.corrente_a, 2, 'A');
    mostrarValor('leituraPotencia', l.potencia_w, 0, 'W');
    mostrarValor('leituraEnergia', l.energia_kwh, 3, 'kWh');
    mostrarValor('leituraPh', l.ph, 2, '', 'Aguardando sensor');
    mostrarValor('leituraTemperatura', l.temperatura_c, 1, '°C', 'Aguardando sensor');
    mostrarValor('leituraOrp', l.orp_mv, 0, 'mV', 'Aguardando sensor');

    if (l.ultima_leitura) {
      const dataLeitura = new Date(l.ultima_leitura);
      document.getElementById('ultimaLeitura').innerText = `Última leitura: ${dataLeitura.toLocaleString('pt-BR')}`;
    } else {
      document.getElementById('ultimaLeitura').innerText = 'Nenhuma leitura recebida';
    }
  } catch (err) {
    console.error(err);
    document.getElementById('deviceStatusLine').innerText = 'Controlador: erro de comunicação';
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
    setTimeout(carregarPainelIoT, 5500);
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

document.getElementById('btnSalvarMotor').addEventListener('click', salvarDadosMotor);

carregarPiscinas();
