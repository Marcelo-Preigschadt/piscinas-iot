const API = 'https://wqjzrbhbkienlxocykcn.supabase.co/functions/v1/piscinas-api';

function limparSessaoAnterior() {
  ['token','token_expires_at','usuario','nome_usuario','cliente_id','perfil','logado','primeiro_acesso','piscina_id']
    .forEach(k => localStorage.removeItem(k));
}

async function login() {
  const usuario = document.getElementById('usuario').value.trim();
  const senha = document.getElementById('senha').value;
  const erro = document.getElementById('erro');
  const btn = document.getElementById('btnEntrar');

  if (!usuario || !senha) {
    erro.innerText = 'Informe usuário e senha';
    return;
  }

  erro.innerText = '';
  btn.disabled = true;
  btn.textContent = 'Entrando...';

  try {
    limparSessaoAnterior();

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
    localStorage.setItem('piscina_id', data.piscina_id ? String(data.piscina_id) : '');
    localStorage.setItem('primeiro_acesso', data.primeiro_acesso ? 'true' : 'false');
    localStorage.setItem('logado', 'true');

    window.location.href = data.primeiro_acesso ? 'senha.html' : 'index.html';
  } catch (err) {
    console.error(err);
    erro.innerText = 'Não foi possível conectar ao servidor';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter') login();
});
