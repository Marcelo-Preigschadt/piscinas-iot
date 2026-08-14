const API = 'https://wqjzrbhbkienlxocykcn.supabase.co/functions/v1/piscinas-api';

function limparSessao() {
  ['token','token_expires_at','usuario','nome_usuario','cliente_id','perfil','logado','primeiro_acesso','piscina_id']
    .forEach(k => localStorage.removeItem(k));
}

if (localStorage.getItem('logado') !== 'true' || !localStorage.getItem('token')) {
  limparSessao();
  window.location.href = 'login.html';
}

if (localStorage.getItem('primeiro_acesso') !== 'true') {
  window.location.href = 'index.html';
}

async function salvarNovaSenha() {
  const novaSenha = document.getElementById('novaSenha').value;
  const confirmarSenha = document.getElementById('confirmarSenha').value;
  const status = document.getElementById('statusSenha');
  const btn = document.getElementById('btnSalvarSenha');

  status.classList.remove('success');
  status.textContent = '';

  if (novaSenha.length < 6) {
    status.textContent = 'A nova senha deve ter pelo menos 6 caracteres.';
    return;
  }

  if (novaSenha !== confirmarSenha) {
    status.textContent = 'As senhas não conferem.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    const res = await fetch(`${API}/me/senha`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({ nova_senha: novaSenha })
    });

    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      limparSessao();
      window.location.href = 'login.html';
      return;
    }

    if (!res.ok) {
      throw new Error(data.erro || 'Não foi possível alterar a senha');
    }

    localStorage.setItem('primeiro_acesso', 'false');
    status.classList.add('success');
    status.textContent = 'Senha alterada com sucesso.';

    setTimeout(() => {
      window.location.href = 'index.html';
    }, 700);
  } catch (err) {
    console.error(err);
    status.textContent = err.message || 'Erro ao alterar a senha';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar nova senha';
  }
}

document.getElementById('btnSalvarSenha').addEventListener('click', salvarNovaSenha);
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') salvarNovaSenha();
});
