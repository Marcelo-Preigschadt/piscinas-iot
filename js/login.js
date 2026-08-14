async function login() {
  const usuario = document.getElementById('usuario').value;
  const senha = document.getElementById('senha').value;

  if (!usuario || !senha) {
    document.getElementById('erro').innerText = 'Informe usuário e senha';
    return;
  }

  try {
    const res = await fetch('https://wqjzrbhbkienlxocykcn.supabase.co/functions/v1/piscinas-api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, senha })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      document.getElementById('erro').innerText = data.erro || 'Erro ao fazer login';
      return;
    }

    // Salva informações no localStorage
    localStorage.setItem('usuario', data.usuario);
    localStorage.setItem('logado', 'true');

    // Redireciona para a tela principal
    window.location.href = 'index.html';
  } catch (err) {
    console.error(err);
    document.getElementById('erro').innerText = 'Não foi possível conectar ao servidor';
  }
}
