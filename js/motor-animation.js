(() => {
  const CONTROL = 'https://wqjzrbhbkienlxocykcn.supabase.co/functions/v1/piscinas-control';
  const statusEl = document.getElementById('statusMotor');
  const deviceLine = document.getElementById('deviceStatusLine');
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
  let pendingSeq = 0;
  let fastPollTimer = null;
  let fastPollStartedAt = 0;
  let envioEmCurso = false;

  const painelOriginal = typeof window.carregarPainelIoT === 'function'
    ? window.carregarPainelIoT
    : null;

  function piscinaAtual() {
    try { return piscinaSelecionada || null; } catch (_) { return null; }
  }

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
      running: ['Bomba em funcionamento', 'Retorno do motor confirmado pelo GPIO 27'],
      starting: ['Acionando bomba…', 'Aguardando confirmação física pelo GPIO 27'],
      stopping: ['Desligando bomba…', 'Aguardando confirmação física pelo GPIO 27'],
      offline: ['Controlador offline', 'Comando permanece pendente até o ESP32 reconectar'],
      disconnected: ['Sem controlador', 'Vincule um ESP32 para controlar a bomba']
    };

    stateEl.textContent = textos[estado][0];
    hintEl.textContent = textos[estado][1];
  }

  function aplicarFalhaRetorno(data) {
    visual.classList.remove('is-running', 'is-starting', 'is-stopping', 'is-offline', 'is-disconnected');
    visual.classList.add('is-stopped');
    visual.dataset.state = 'fault';

    if (data?.rele === 'ligado' && data?.motor !== 'ligado') {
      stateEl.textContent = 'Motor sem retorno';
      hintEl.textContent = 'Relé ligado, mas o GPIO 27 não confirma funcionamento';
    } else {
      stateEl.textContent = 'Retorno incompatível';
      hintEl.textContent = 'GPIO 27 indica motor ativo com o relé desligado';
    }
  }

  function atualizarLinhaControlador(data) {
    if (!deviceLine || !data) return;
    const id = data.device_id || 'controlador';
    const status = data.status === 'online' ? 'ONLINE' : 'OFFLINE';
    const wifi = data.wifi_ssid ? ` • Wi-Fi: ${data.wifi_ssid}` : ' • Wi-Fi: não informado';
    deviceLine.textContent = `Controlador: ${id} • ${status}${wifi}`;
  }

  async function controlFetch(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${localStorage.getItem('token') || ''}`);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    const res = await fetch(`${CONTROL}${path}`, { ...options, headers, cache: 'no-store' });
    if (res.status === 401) {
      if (typeof window.sair === 'function') window.sair();
      throw new Error('Sessão expirada');
    }
    return res;
  }

  function pararConsultaRapida() {
    if (fastPollTimer) {
      clearInterval(fastPollTimer);
      fastPollTimer = null;
    }
  }

  function estadoConfirmado(acao, motor) {
    return (acao === 'ligar' && motor === 'ligado') ||
      (acao === 'desligar' && motor === 'desligado');
  }

  function idadeComandoMs(data) {
    if (!data?.comando_criado_em) return 0;
    const t = new Date(data.comando_criado_em).getTime();
    return Number.isFinite(t) ? Math.max(0, Date.now() - t) : 0;
  }

  function renderizarControle(data) {
    if (!data) return false;

    atualizarLinhaControlador(data);

    if (data.status === 'offline') {
      statusEl.textContent = data.pendente ? 'COMANDO PENDENTE / OFFLINE' : 'OFFLINE';
      statusEl.classList.remove('ligado');
      statusEl.classList.add('desligado');
      aplicarEstado('offline');
      return false;
    }

    const retornoIncompativel =
      (data.rele === 'ligado' || data.rele === 'desligado') &&
      (data.motor === 'ligado' || data.motor === 'desligado') &&
      data.rele !== data.motor;

    if (data.pendente) {
      const acao = data.comando || pendingAction;
      pendingAction = acao;
      pendingSeq = Number(data.comando_seq || pendingSeq || 0);

      const falhaDeRetorno = retornoIncompativel && idadeComandoMs(data) >= 3000;
      if (falhaDeRetorno) {
        statusEl.textContent = data.rele === 'ligado'
          ? 'MOTOR DESLIGADO / RELÉ LIGADO'
          : 'RETORNO ATIVO / RELÉ DESLIGADO';
        statusEl.classList.remove('ligado');
        statusEl.classList.add('desligado');
        aplicarFalhaRetorno(data);
      } else {
        statusEl.textContent = 'AGUARDANDO RETORNO DO MOTOR...';
        statusEl.classList.remove('ligado', 'desligado');
        aplicarEstado(acao === 'desligar' ? 'stopping' : 'starting');
      }
      return false;
    }

    if (retornoIncompativel) {
      pendingAction = null;
      pendingSeq = 0;
      pararConsultaRapida();
      statusEl.textContent = data.rele === 'ligado'
        ? 'MOTOR DESLIGADO / RELÉ LIGADO'
        : 'RETORNO ATIVO / RELÉ DESLIGADO';
      statusEl.classList.remove('ligado');
      statusEl.classList.add('desligado');
      aplicarFalhaRetorno(data);
      return false;
    }

    const motor = data.motor === 'ligado' ? 'ligado' : 'desligado';
    statusEl.textContent = motor === 'ligado' ? 'LIGADO' : 'DESLIGADO';
    statusEl.classList.remove('ligado', 'desligado');
    statusEl.classList.add(motor === 'ligado' ? 'ligado' : 'desligado');
    aplicarEstado(motor === 'ligado' ? 'running' : 'stopped');

    const confirmou = pendingAction ? estadoConfirmado(pendingAction, motor) : true;
    if (confirmou) {
      pendingAction = null;
      pendingSeq = 0;
      pararConsultaRapida();
      if (typeof window.carregarConsumo === 'function') window.carregarConsumo();
    }
    return confirmou;
  }

  async function consultarControle() {
    const piscina = piscinaAtual();
    if (!piscina) return null;
    const res = await controlFetch(`/motor/${piscina.id}/status`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Erro ao consultar o controlador');
    renderizarControle(data);
    return data;
  }

  window.carregarPainelIoT = async function carregarPainelIoTV2() {
    if (painelOriginal) {
      try { await painelOriginal(); } catch (_) {}
    }
    try {
      await consultarControle();
    } catch (err) {
      console.error('Controle do motor:', err);
      if (pendingAction) {
        statusEl.textContent = 'AGUARDANDO RETORNO DO MOTOR...';
        aplicarEstado(pendingAction === 'desligar' ? 'stopping' : 'starting');
      }
    }
  };

  function iniciarConsultaRapida() {
    pararConsultaRapida();
    fastPollStartedAt = Date.now();

    const executar = async () => {
      try {
        const data = await consultarControle();
        if (data && !data.pendente && pendingAction && estadoConfirmado(pendingAction, data.motor)) {
          pendingAction = null;
          pendingSeq = 0;
          pararConsultaRapida();
          if (typeof window.carregarConsumo === 'function') window.carregarConsumo();
          return;
        }
      } catch (_) {}

      if (Date.now() - fastPollStartedAt >= 15000) {
        pararConsultaRapida();
        try { await consultarControle(); } catch (_) {}
      }
    };

    executar();
    fastPollTimer = setInterval(executar, 500);
  }

  window.enviarComando = async function enviarComandoV2(acao) {
    const piscina = piscinaAtual();
    if (!piscina || envioEmCurso) return;
    envioEmCurso = true;

    pendingAction = acao;
    statusEl.textContent = 'ENVIANDO COMANDO...';
    statusEl.classList.remove('ligado', 'desligado');
    aplicarEstado(acao === 'desligar' ? 'stopping' : 'starting');

    try {
      const res = await controlFetch(`/motor/${piscina.id}/${acao}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.erro || `Falha ao ${acao} o motor`);

      pendingSeq = Number(data.comando_seq || 0);
      if (data.dispositivo === 'offline') {
        statusEl.textContent = 'COMANDO PENDENTE / OFFLINE';
        aplicarEstado('offline');
      } else {
        statusEl.textContent = 'AGUARDANDO RETORNO DO MOTOR...';
        iniciarConsultaRapida();
      }
    } catch (err) {
      pendingAction = null;
      pendingSeq = 0;
      pararConsultaRapida();
      alert(err.message || 'Erro na comunicação com o servidor');
      try { await consultarControle(); } catch (_) {}
    } finally {
      setTimeout(() => { envioEmCurso = false; }, 350);
    }
  };

  window.ligarMotor = () => window.enviarComando('ligar');
  window.desligarMotor = () => window.enviarComando('desligar');

  btnLigar?.addEventListener('click', () => {
    if (pendingAction === 'ligar') aplicarEstado('starting');
  });

  btnDesligar?.addEventListener('click', () => {
    if (pendingAction === 'desligar') aplicarEstado('stopping');
  });

  const observer = new MutationObserver(() => {
    const texto = (statusEl.textContent || '').trim().toUpperCase();
    if (texto.includes('SEM CONTROLADOR')) return aplicarEstado('disconnected');
    if (texto.includes('MOTOR DESLIGADO') || texto.includes('RETORNO ATIVO')) return;
    if (texto.includes('PENDENTE') || texto.includes('AGUARDANDO') || texto.includes('ENVIANDO')) {
      return aplicarEstado(pendingAction === 'desligar' ? 'stopping' : 'starting');
    }
    if (texto === 'LIGADO') return aplicarEstado('running');
    if (texto === 'DESLIGADO') return aplicarEstado('stopped');
    if (texto.includes('OFFLINE')) return aplicarEstado('offline');
  });

  observer.observe(statusEl, { childList: true, characterData: true, subtree: true });

  setTimeout(() => {
    window.carregarPainelIoT?.();
  }, 250);
})();