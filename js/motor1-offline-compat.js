(() => {
  // Os comandos da interface são independentes do estado/versão do ESP32.
  // O backend aceita e mantém o comando pendente até o controlador processá-lo.
  function liberarComandosDosMotores() {
    document
      .querySelectorAll('.multi-motor-card .multi-motor-buttons button')
      .forEach((botao) => {
        if (botao.disabled) botao.disabled = false;
        botao.removeAttribute('disabled');
      });

    document
      .querySelectorAll('.multi-motor-card [data-role="safety"]')
      .forEach((el) => {
        const texto = String(el.textContent || '');
        if (texto.startsWith('AGUARDANDO FIRMWARE MULTIMOTOR')) {
          el.textContent = texto.replace('AGUARDANDO FIRMWARE MULTIMOTOR', 'COMANDO DISPONÍVEL • firmware multimotor ainda não instalado');
        }
      });
  }

  const observer = new MutationObserver(() => liberarComandosDosMotores());
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['disabled']
  });

  document.addEventListener('visibilitychange', liberarComandosDosMotores);
  document.addEventListener('DOMContentLoaded', liberarComandosDosMotores);
  setInterval(liberarComandosDosMotores, 250);
  liberarComandosDosMotores();
})();
