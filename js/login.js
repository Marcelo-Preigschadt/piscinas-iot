const API = 'https://wqjzrbhbkienlxocykcn.supabase.co/functions/v1/piscinas-api';

async function login() {
  const usuario = document.getElementById('usuario').value.trim();
  const senha = document.getElementById('senha').value;
  const erro = document.getElementById('erro');

  if (!usuario || !senha) {
    erro.innerText = 'Informe usuário e senha';
    return;
  }

  erro.innerText = '';

  try {
    const res = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, senha })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.token) {
      erro.innerText = data.erro || 'Erro ao fazer login';
      return;
    }

    localStorage.setItem('token', data.token);
    localStorage.setItem('token_expires_at', data.expires_at || '');
    localStorage.setItem('usuario', data.usuario || usuario);
    localStorage.setItem('nome_usuario', data.nome || data.usuario || usuario);
    localStorage.setItem('cliente_id', String(data.cliente_id || ''));
    localStorage.setItem('perfil', data.perfil || 'cliente');
    localStorage.setItem('logado', 'true');

    window.location.href = 'index.html';
  } catch (err) {
    console.error(err);
    erro.innerText = 'Não foi possível conectar ao servidor';
  }
}
