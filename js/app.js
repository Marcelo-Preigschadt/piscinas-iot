// Redireciona para login se não estiver logado
if (localStorage.getItem('logado') !== 'true') {
  window.location.href = 'login.html';
}

const API = 'https://wqjzrbhbkienlxocykcn.supabase.co/functions/v1/piscinas-api/piscinas';

// Carrega piscinas
async function carregarPiscinas() {
  try {
    const res = await fetch(API);
    const piscinas = await res.json();

    const lista = document.getElementById('listaPiscinas');
    lista.innerHTML = '';

    piscinas.forEach(p => {
      const li = document.createElement('li');
      li.innerHTML = `
        ${p.nome} - ${p.localizacao || 'Sem localização'}
        <button onclick="removerPiscina(${p.id})">Remover</button>
      `;
      lista.appendChild(li);
    });
  } catch (err) {
    console.error(err);
    alert('Erro ao carregar piscinas');
  }
}

// Criar piscina
async function criarPiscina() {
  const nome = document.getElementById('nome').value;
  const localizacao = document.getElementById('localizacao').value;

  if (!nome) return alert('Informe o nome da piscina');

  try {
    await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, localizacao })
    });

    document.getElementById('nome').value = '';
    document.getElementById('localizacao').value = '';

    carregarPiscinas();
  } catch (err) {
    console.error(err);
    alert('Erro ao criar piscina');
  }
}

// Remover piscina
async function removerPiscina(id) {
  try {
    await fetch(`${API}/${id}`, { method: 'DELETE' });
    carregarPiscinas();
  } catch (err) {
    console.error(err);
    alert('Erro ao remover piscina');
  }
}

// Logout
function logout() {
  localStorage.removeItem('usuario');
  localStorage.removeItem('logado');
  window.location.href = 'login.html';
}

// Abrir agenda
function abrirAgenda() {
  window.location.href = 'agenda.html';
}

// Inicialização após DOM carregado
document.addEventListener('DOMContentLoaded', () => {
  // Vincula botões às funções
  document.getElementById('btnSair').addEventListener('click', logout);
  document.getElementById('btnAgenda').addEventListener('click', abrirAgenda);
  document.getElementById('btnCriar').addEventListener('click', criarPiscina);

  // Mostra usuário logado
  const usuario = localStorage.getItem('usuario');
  if (usuario) {
    document.getElementById('userDisplay').innerText = `Bem-vindo, ${usuario}`;
  }

  // Carrega piscinas
  carregarPiscinas();
});
