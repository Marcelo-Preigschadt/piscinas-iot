const QUATRIN_REPORTS_API = 'https://wqjzrbhbkienlxocykcn.supabase.co/functions/v1/piscinas-relatorios';

async function quatrinAdminFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${localStorage.getItem('token') || ''}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${QUATRIN_REPORTS_API}${path}`, { ...options, headers });
}

function prepararAcoesClientes() {
  if ((localStorage.getItem('perfil') || 'cliente') !== 'admin') return;

  document.querySelectorAll('#clientesGrid .client-card').forEach(card => {
    const vinculo = card.querySelector('[data-link-client]');
    const actions = card.querySelector('.client-actions');
    if (!vinculo || !actions) return;

    const clienteId = Number(vinculo.dataset.linkClient || 0);
    if (!clienteId) return;

    const botaoAcesso = actions.querySelector('[data-delete-user]');
    if (botaoAcesso) botaoAcesso.textContent = 'Excluir acesso';

    if (actions.querySelector('[data-delete-client-extra]')) return;

    const nome = card.querySelector('h3')?.textContent?.trim() || 'este cliente';
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'btn-danger-solid';
    botao.dataset.deleteClientExtra = String(clienteId);
    botao.textContent = 'Excluir cliente';

    botao.addEventListener('click', async () => {
      const confirmar = confirm(
        `Excluir definitivamente ${nome}?\n\n` +
        'O usuário e a senha serão removidos. A piscina e o ESP32 não serão apagados; a piscina ficará disponível para outro vínculo.'
      );
      if (!confirmar) return;

      botao.disabled = true;
      botao.textContent = 'Excluindo...';

      try {
        const res = await quatrinAdminFetch(`/clientes/${clienteId}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.erro || 'Erro ao excluir cliente');

        if (typeof carregarClientes === 'function' && typeof carregarPiscinas === 'function') {
          await Promise.all([carregarClientes(), carregarPiscinas()]);
        } else {
          window.location.reload();
        }
      } catch (err) {
        alert(err.message || 'Erro ao excluir cliente');
        botao.disabled = false;
        botao.textContent = 'Excluir cliente';
      }
    });

    actions.appendChild(botao);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if ((localStorage.getItem('perfil') || 'cliente') !== 'admin') return;

  const style = document.createElement('style');
  style.textContent = `
    .btn-danger-solid{border-radius:9px;padding:10px 14px;font-weight:800;border:1px solid #b93f34;background:#c94838;color:#fff;transition:.15s}
    .btn-danger-solid:hover{background:#a9342b}
    .btn-danger-solid:disabled{opacity:.6;cursor:wait}
    @media(max-width:700px){.btn-danger-solid{width:100%}}
  `;
  document.head.appendChild(style);

  const grid = document.getElementById('clientesGrid');
  if (grid) {
    const observer = new MutationObserver(prepararAcoesClientes);
    observer.observe(grid, { childList: true, subtree: true });
  }

  prepararAcoesClientes();
});
