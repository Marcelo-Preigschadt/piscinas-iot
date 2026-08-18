(() => {
  const statusEl = document.getElementById('statusMotor');
  const botoes = document.querySelector('.motor-buttons');
  const btnLigar = document.querySelector('.motor-buttons .ligar');
  const btnDesligar = document.querySelector('.motor-buttons .desligar');
  if (!statusEl || !botoes) return;

  let visual = document.getElementById('motorVisual');
  if (!visual) {
    visual = document.createElement('div');
    visual.id = 'motorVisual';
    visual.className = 'motor-visual is-stopped';
    visual.innerHTML = `
      <div class="motor-visual-head">
        <span class="motor-visual-label">Bomba da filtragem</span>
        <strong id="motorVisualState" class="motor-visual-state">Motor parado</strong>
      </div>
      <div class="motor-stage" aria-hidden="true">
        <div class="pump-machine">
          <div class="pump-terminal"></div>
          <div class="pump-motor"></div>
          <div class="pump-coupling"></div>
          <div class="pump-outlet"></div>
          <div class="pump-volute"></div>
          <div class="pump-inlet"></div>
          <div class="pump-rotor"><span class="pump-rotor-center"></span></div>
          <div class="pump-base"></div>
        </div>
      </div>
      <div id="motorVisualHint" class="motor-visual-hint">Pronto para acionamento</div>`;
    botoes.insertAdjacentElement('afterend', visual);
  }

  const stateEl = document.getElementById('motorVisualState');
  const hintEl = document.getElementById('motorVisualHint');
  let pendingAction = null;
  let fastPollTimer = null;
  let fastPollStartedAt = 0;

  function aplicarEstado(estado) {
    visual.classList.remove(
      'is-stopped',
      'is-running',
      'is-starting',
      'is-stopping',
      'is-offline',
      'is-disconnected'
    );
    visual.classList.add(`is-${estado}`);
    visual.dataset.state = estado;

    const textos = {
      stopped: ['Motor parado', 'Pronto para acionamento'],
      running: ['Bomba em funcionamento', 'Rotor ativo · consumo sendo calculado'],
      starting: ['Acionando bomba…', 'Comando enviado ao controlador'],
      stopping: ['Desligando bomba…', 'Aguardando confirmação do controlador'],
      offline: ['Controlador offline', 'Comando pode permanecer pendente'],
      disconnected: ['Sem controlador', 'Vincule um ESP32 para controlar a bomba']
    };

    stateEl.textContent = textos[estado][0];
    hintEl.textContent = textos[estado][1];
  }

  function pararConsultaRapida() {
    if (fastPollTimer) {
      clearInterval(fastPollTimer);
      fastPollTimer = null;
    }
  }

  function iniciarConsultaRapida(acao) {
    pararConsultaRapida();
    fastPollStartedAt = Date.now();

    // Consulta o banco rapidamente logo após o comando, em vez de esperar
    // o ciclo normal de 5 segundos da tela.
    fastPollTimer = setInterval(async () => {
      try {
        if (typeof carregarPainelIoT === 'function') await carregarPainelIoT();
        if (typeof carregarConsumo === 'function') carregarConsumo();
      } catch (_) {}

      const texto = (statusEl.textContent || '').trim().toUpperCase();
      const confirmado =
        (acao === 'ligar' && texto === 'LIGADO') ||
        (acao === 'desligar' && texto === 'DESLIGADO');

      if (confirmado || Date.now() - fastPollStartedAt > 6500) {
        pararConsultaRapida();
      }
    }, 350);
  }

  function sincronizar() {
    const texto = (statusEl.textContent || '').trim().toUpperCase();

    if (texto.includes('SEM CONTROLADOR')) {
      pararConsultaRapida();
      return aplicarEstado('disconnected');
    }

    if (texto.includes('PENDENTE') || texto.includes('AGUARDANDO')) {
      return aplicarEstado(pendingAction === 'desligar' ? 'stopping' : 'starting');
    }

    if (texto === 'LIGADO') {
      pendingAction = null;
      pararConsultaRapida();
      return aplicarEstado('running');
    }

    if (texto === 'DESLIGADO') {
      pendingAction = null;
      pararConsultaRapida();
      return aplicarEstado('stopped');
    }

    if (texto.includes('OFFLINE')) {
      pararConsultaRapida();
      return aplicarEstado('offline');
    }
  }

  btnLigar?.addEventListener('click', () => {
    pendingAction = 'ligar';
    aplicarEstado('starting');
    iniciarConsultaRapida('ligar');
  });

  btnDesligar?.addEventListener('click', () => {
    pendingAction = 'desligar';
    aplicarEstado('stopping');
    iniciarConsultaRapida('desligar');
  });

  const observer = new MutationObserver(sincronizar);
  observer.observe(statusEl, {
    childList: true,
    characterData: true,
    subtree: true
  });

  sincronizar();
})();
