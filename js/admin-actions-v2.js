(() => {
  if ((localStorage.getItem('perfil') || 'cliente') !== 'admin') return;

  const REPORTS_API = 'https://wqjzrbhbkienlxocykcn.supabase.co/functions/v1/piscinas-relatorios';
  const originalRenderizarClientes = window.renderizarClientes;

  if (typeof originalRenderizarClientes !== 'function') return;

  async function excluirCliente(clienteId, nome, botao) {
    const confirmar = confirm(
      `Excluir definitivamente ${nome}?\n\n` +
      'O usuário e a senha serão removidos. A piscina e o ESP32 serão preservados e ficarão disponíveis para novo vínculo.'
    );
    if (!confirmar) return;

    botao.disabled = true;
    botao.textContent = 'Excluindo...';

    try {
      const res = await fetch(`${REPORTS_API}/clientes/${clienteId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.erro || 'Erro ao excluir cliente');

      if (typeof window.carregarClientes === 'function') await window.carregarClientes();
      if (typeof window.carregarPiscinas === 'function') await window.carregarPiscinas();
    } catch (err) {
      alert(err.message || 'Erro ao excluir cliente');
      botao.disabled = false;
      botao.textContent = 'Excluir cliente';
    }
  }

  function adicionarAcoesAdministrativas() {
    const grid = document.getElementById('clientesGrid');
    if (!grid) return;

    grid.querySelectorAll('.client-card').forEach(card => {
      const vinculo = card.querySelector('[data-link-client]');
      const actions = card.querySelector('.client-actions');
      if (!vinculo || !actions) return;

      const clienteId = Number(vinculo.dataset.linkClient || 0);
      if (!clienteId) return;

      const botaoAcesso = actions.querySelector('[data-delete-user]');
      if (botaoAcesso) botaoAcesso.textContent = 'Excluir acesso';

      const nome = card.querySelector('h3')?.textContent?.trim() || 'este cliente';
      const botaoCliente = document.createElement('button');
      botaoCliente.type = 'button';
      botaoCliente.className = 'btn-danger-solid';
      botaoCliente.textContent = 'Excluir cliente';
      botaoCliente.addEventListener('click', () => excluirCliente(clienteId, nome, botaoCliente));
      actions.appendChild(botaoCliente);
    });
  }

  window.renderizarClientes = function (...args) {
    const retorno = originalRenderizarClientes.apply(this, args);
    adicionarAcoesAdministrativas();
    return retorno;
  };

  const style = document.createElement('style');
  style.textContent = `
    .btn-danger-solid{border-radius:9px;padding:10px 14px;font-weight:800;border:1px solid #b93f34;background:#c94838;color:#fff;transition:.15s;cursor:pointer}
    .btn-danger-solid:hover{background:#a9342b}
    .btn-danger-solid:disabled{opacity:.6;cursor:wait}
    @media(max-width:700px){.btn-danger-solid{width:100%}}
  `;
  document.head.appendChild(style);
})();