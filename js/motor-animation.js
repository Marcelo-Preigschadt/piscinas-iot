(() => {
  const visual = document.getElementById('motorVisual');
  const statusEl = document.getElementById('statusMotor');
  const stateEl = document.getElementById('motorVisualState');
  const hintEl = document.getElementById('motorVisualHint');
  const btnLigar = document.querySelector('.motor-buttons .ligar');
  const btnDesligar = document.querySelector('.motor-buttons .desligar');
  if (!visual || !statusEl || !stateEl || !hintEl) return;

  let pendingAction = null;

  function aplicarEstado(estado) {
    visual.classList.remove('is-stopped','is-running','is-starting','is-stopping','is-offline','is-disconnected');
    visual.classList.add(`is-${estado}`);
    visual.dataset.state = estado;

    const textos = {
      stopped: ['Motor parado', 'Pronto para acionamento'],
      running: ['Motor em funcionamento', 'Rotação ativa · consumo sendo calculado'],
      starting: ['Acionando motor…', 'Comando enviado ao controlador'],
      stopping: ['Desligando motor…', 'Aguardando confirmação do controlador'],
      offline: ['Controlador offline', 'Comando pode permanecer pendente'],
      disconnected: ['Sem controlador', 'Vincule um ESP32 para controlar o motor']
    };
    stateEl.textContent = textos[estado][0];
    hintEl.textContent = textos[estado][1];
  }

  function sincronizar() {
    const texto = (statusEl.textContent || '').trim().toUpperCase();
    if (texto.includes('SEM CONTROLADOR')) return aplicarEstado('disconnected');
    if (texto.includes('PENDENTE') || texto.includes('AGUARDANDO')) {
      return aplicarEstado(pendingAction === 'desligar' ? 'stopping' : 'starting');
    }
    if (texto === 'LIGADO') {
      pendingAction = null;
      return aplicarEstado('running');
    }
    if (texto === 'DESLIGADO') {
      pendingAction = null;
      return aplicarEstado('stopped');
    }
    if (texto.includes('OFFLINE')) return aplicarEstado('offline');
  }

  btnLigar?.addEventListener('click', () => {
    pendingAction = 'ligar';
    aplicarEstado('starting');
  });
  btnDesligar?.addEventListener('click', () => {
    pendingAction = 'desligar';
    aplicarEstado('stopping');
  });

  const observer = new MutationObserver(sincronizar);
  observer.observe(statusEl, { childList: true, characterData: true, subtree: true });
  sincronizar();
})();
