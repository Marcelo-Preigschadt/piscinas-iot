if (localStorage.getItem('logado') !== 'true') {
  window.location.href = 'login.html';
}
const API = 'https://wqjzrbhbkienlxocykcn.supabase.co/functions/v1/piscinas-api';
let piscinaSelecionada = null;

/* CARREGA PISCINAS */
async function carregarPiscinas() {
  const res = await fetch(`${API}/piscinas`);
  const piscinas = await res.json();

  const container = document.getElementById('piscinasCards');
  container.innerHTML = '';

  piscinas.forEach(p => {
    const card = document.createElement('div');
    card.className = 'card-piscina';
    card.innerHTML = `<strong>${p.nome}</strong><br>${p.localizacao}`;
    card.onclick = () => abrirAgenda(p);
    container.appendChild(card);
  });
}

/* ABRIR AGENDA DA PISCINA */
function abrirAgenda(piscina) {
  piscinaSelecionada = piscina;

  document.getElementById('listaPiscinasAgenda').classList.add('hidden');
  document.getElementById('agendaPiscina').classList.remove('hidden');

  document.getElementById('nomePiscina').innerText = piscina.nome;

  carregarAgenda();
}

/* VOLTAR */
function voltar() {
  document.getElementById('agendaPiscina').classList.add('hidden');
  document.getElementById('listaPiscinasAgenda').classList.remove('hidden');
}

/* CARREGAR AGENDA */
async function carregarAgenda() {
  const res = await fetch(`${API}/agenda/${piscinaSelecionada.id}`);
  const dados = await res.json();

  const tbody = document.querySelector('#lista-agenda tbody');
  tbody.innerHTML = '';

  dados.forEach(a => {
    tbody.innerHTML += `
      <tr>
        <td>${diaTexto(a.dia_semana)}</td>
        <td>${a.hora_inicio}</td>
        <td>${a.duracao_min} min</td>
        <td>
          <button onclick="remover(${a.id})">Excluir</button>
        </td>
      </tr>
    `;
  });
}

/* ADICIONAR HORÁRIO */
document.getElementById('formAgenda').addEventListener('submit', async e => {
  e.preventDefault();

  await fetch(`${API}/agenda`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      piscina_id: piscinaSelecionada.id,
      dia_semana: dia.value,
      hora_inicio: hora.value,
      duracao_min: duracao.value
    })
  });

  carregarAgenda();
});

/* REMOVER */
async function remover(id) {
  await fetch(`${API}/agenda/${id}`, { method: 'DELETE' });
  carregarAgenda();
}

function diaTexto(d) {
  return ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d];
}
/* FUNÇÃO PARA SAIR */
function sair() {
  localStorage.removeItem('logado');
  localStorage.removeItem('usuario');
  window.location.href = 'login.html';
}

/* FUNÇÃO VOLTAR */
function voltar() {
  // Se estiver na tela de seleção de piscina, volta para index
  if (!document.getElementById('agendaPiscina').classList.contains('hidden')) {
    // Se a agenda está visível, volta para lista de piscinas
    document.getElementById('agendaPiscina').classList.add('hidden');
    document.getElementById('listaPiscinasAgenda').classList.remove('hidden');
  } else {
    // Se já estiver na lista de piscinas, volta para index
    window.location.href = 'index.html';
  }
}
/* FUNÇÃO PARA LIGAR O MOTOR */
async function ligarMotor() {
  if (!piscinaSelecionada) return alert('Selecione uma piscina primeiro');

  try {
    const res = await fetch(`${API}/motor/${piscinaSelecionada.id}/ligar`, { method: 'POST' });
    if (res.ok) {
      document.getElementById('statusMotor').innerText = 'LIGADO';
      document.getElementById('statusMotor').classList.add('ligado');
      document.getElementById('statusMotor').classList.remove('desligado');
    } else {
      alert('Falha ao ligar o motor');
    }
  } catch (err) {
    console.error(err);
    alert('Erro na comunicação com o servidor');
  }
}

/* FUNÇÃO PARA DESLIGAR O MOTOR */
async function desligarMotor() {
  if (!piscinaSelecionada) return alert('Selecione uma piscina primeiro');

  try {
    const res = await fetch(`${API}/motor/${piscinaSelecionada.id}/desligar`, { method: 'POST' });
    if (res.ok) {
      document.getElementById('statusMotor').innerText = 'DESLIGADO';
      document.getElementById('statusMotor').classList.add('desligado');
      document.getElementById('statusMotor').classList.remove('ligado');
    } else {
      alert('Falha ao desligar o motor');
    }
  } catch (err) {
    console.error(err);
    alert('Erro na comunicação com o servidor');
  }
}



carregarPiscinas();
