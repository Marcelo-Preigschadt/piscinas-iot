(() => {
  const CONTROL = 'https://wqjzrbhbkienlxocykcn.supabase.co/functions/v1/piscinas-control';
  const statusEl = document.getElementById('statusMotor');
  const deviceLine = document.getElementById('deviceStatusLine');
  const relayStateEl = document.getElementById('relayState');
  const motorReturnEl = document.getElementById('motorReturnState');
  const safetyStateEl = document.getElementById('safetyState');
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
  let monitorContinuoTimer = null;
  let consultaEmCurso = false;
  let envioEmCurso = false;

  const painelOriginal = typeof window.carregarPainelIoT === 'function'
    ? window.carregarPainelIoT
    : null;

  function piscinaAtual() {
    try { return piscinaSelecionada || null; } catch (_) { return null; }
  }

  function limparClassesDiag(el) {
    if (!el) return;
    const item = el.closest('.motor-diag-item');
    item?.classList.remove('is-ok', 'is-warn', 'is-fault', 'is-stale');
    return item;
  }

  function diag(el, texto, classe = '') {
    if (!el) return;
    el.textContent = texto;
    const item = limparClassesDiag(el);
    if (classe) item?.classList.add(classe);
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
      running: ['Bomba em funcionamento', 'Retorno físico confirmado pelo GPIO 27'],
      starting: ['Acionando bomba…', 'Aguardando retorno físico do motor'],
      stopping: ['Desligando bomba…', 'Aguardando retorno físico desligado'],
      offline: ['Controlador sem comunicação', 'O estado do motor não pode ser confirmado agora'],
      disconnected: ['Sem controlador', 'Vincule um ESP32 para controlar a bomba']
    };

    stateEl.textContent = textos[estado][0];
    hintEl.textContent = textos[estado][1];
  }

  function motivoBloqueioTexto(motivo) {
    const textos = {
      retorno_perdido: 'Retorno perdido durante o funcionamento',
      sem_retorno_apos_comando: 'Motor não confirmou a partida após o comando',
      motor_permanece_ligado: 'Motor continuou ativo após comando de desligamento'
    };
    return textos[motivo] || 'Intervenção local ou falha detectada';
  }

  function aplicarBloqueio(data) {
    const motorLigado = data?.motor === 'ligado';
    statusEl.classList.remove('ligado', 'desligado');
    statusEl.classList.add(motorLigado ? 'ligado' : 'desligado');

    if (motorLigado) {
      statusEl.textContent = 'MOTOR LIGADO SEM COMANDO REMOTO';
      aplicarEstado('running');
      stateEl.textContent = 'Motor ligado localmente';
    } else {
      statusEl.textContent = 'DESLIGADO / REARME BLOQUEADO';
      aplicarEstado('stopped');
      stateEl.textContent = 'Motor desligado por segurança';
    }

    hintEl.textContent = `${motivoBloqueioTexto(data?.motivo_bloqueio)}. Envie um novo comando para rearmar.`;
  }

  function atualizarLinhaControlador(data) {
    if (!deviceLine || !data) return;
    const id = data.device_id || 'controlador';
    const segundos = Number.isFinite(Number(data.segundos_sem_ping))
      ? Number(data.segundos_sem_ping)
      : null;

    if (data.status === 'online') {
      const rede = data.wifi_ssid ? ` • Wi-Fi: ${data.wifi_ssid}` : '';
      const sinal = Number.isFinite(Number(data.wifi_rssi)) ? ` • ${Number(data.wifi_rssi)} dBm` : '';
      deviceLine.textContent = `Controlador: ${id} • ONLINE${rede}${sinal}`;
      return;
    }

    if (data.status === 'instavel') {
      const tempo = segundos !== null ? ` • último contato há ${segundos} s` : '';
      const rede = data.ultima_rede_conhecida ? ` • última rede: ${data.ultima_rede_conhecida}` : '';
      deviceLine.textContent = `Controlador: ${id} • CONEXÃO INSTÁVEL${tempo}${rede}`;
      return;
    }

    const tempo = segundos !== null ? ` • sem comunicação há ${segundos} s` : '';
    const ultimaRede = data.ultima_rede_conhecida ? ` • última rede: ${data.ultima_rede_conhecida}` : '';
    deviceLine.textContent = `Controlador: ${id} • OFFLINE${tempo}${ultimaRede}`;
  }

  function atualizarDiagnostico(data) {
    if (!data) return;
    const stale = data.status !== 'online';
    const prefixo = stale ? 'ÚLTIMO: ' : '';

    if (data.rele === 'ligado') diag(relayStateEl, `${prefixo}LIGADO`, stale ? 'is-stale' : 'is-ok');
    else if (data.rele === 'desligado') diag(relayStateEl, `${prefixo}DESLIGADO`, stale ? 'is-stale' : '');
    else diag(relayStateEl, 'SEM DADO', 'is-stale');

    if (data.motor === 'ligado') diag(motorReturnEl, `${prefixo}LIGADO`, stale ? 'is-stale' : 'is-ok');
    else if (data.motor === 'desligado') diag(motorReturnEl, `${prefixo}DESLIGADO`, stale ? 'is-stale' : '');
    else diag(motorReturnEl, 'SEM DADO', 'is-stale');

    if (data.bloqueio_rearme) {
      diag(safetyStateEl, `BLOQUEADO — ${motivoBloqueioTexto(data.motivo_bloqueio)}`, 'is-fault');
      return;
    }

    if (data.rele === 'ligado' && data.motor === 'desligado') {
      diag(safetyStateEl, 'SEM RETORNO — desligamento manual ou falha', 'is-warn');
      return;
    }

    if (data.rele === 'desligado' && data.motor === 'ligado') {
      diag(safetyStateEl, 'MOTOR LIGADO LOCALMENTE', 'is-warn');
      return;
    }

    if (stale) {
      diag(safetyStateEl, 'ESTADO NÃO ATUALIZADO — conexão instável/offline', 'is-stale');
      return;
    }

    diag(safetyStateEl, 'NORMAL', 'is-ok');
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
    atualizarDiagnostico(data);

    if (data.status === 'offline') {
      statusEl.textContent = 'SEM COMUNICAÇÃO';
      statusEl.classList.remove('ligado');
      statusEl.classList.add('desligado');
      aplicarEstado('offline');
      return false;
    }

    if (data.bloqueio_rearme) {
      pendingAction = null;
      pendingSeq = 0;
      pararConsultaRapida();
      aplicarBloqueio(data);
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
          ? 'AGUARDANDO RETORNO DO MOTOR'
          : 'AGUARDANDO DESLIGAMENTO DO MOTOR';
        statusEl.classList.remove('ligado', 'desligado');
        aplicarEstado(acao === 'desligar' ? 'stopping' : 'starting');
      } else {
        statusEl.textContent = 'AGUARDANDO RETORNO DO MOTOR...';
        statusEl.classList.remove('ligado', 'desligado');
        aplicarEstado(acao === 'desligar' ? 'stopping' : 'starting');
      }
      return false;
    }

    if (data.status === 'instavel') {
      const ultimo = data.motor === 'ligado' ? 'LIGADO' : 'DESLIGADO';
      statusEl.textContent = `ÚLTIMO ESTADO: ${ultimo}`;
      statusEl.classList.remove('ligado', 'desligado');
      statusEl.classList.add(data.motor === 'ligado' ? 'ligado' : 'desligado');
      aplicarEstado(data.motor === 'ligado' ? 'running' : 'stopped');
      hintEl.textContent = 'Conexão instável: aguardando novo heartbeat do controlador';
      return false;
    }

    if (retornoIncompativel) {
      pendingAction = null;
      pendingSeq = 0;
      pararConsultaRapida();

      if (data.rele === 'ligado') {
        statusEl.textContent = 'MOTOR SEM RETORNO';
        statusEl.classList.remove('ligado');
        statusEl.classList.add('desligado');
        aplicarEstado('stopped');
        stateEl.textContent = 'Motor sem retorno';
        hintEl.textContent = 'Relé remoto ligado, mas o GPIO 27 indica motor desligado';
      } else {
        statusEl.textContent = 'MOTOR LIGADO LOCALMENTE';
        statusEl.classList.remove('desligado');
        statusEl.classList.add('ligado');
        aplicarEstado('running');
        stateEl.textContent = 'Motor ligado localmente';
        hintEl.textContent = 'GPIO 27 indica motor ligado sem comando do relé remoto';
      }
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
    if (!piscina || consultaEmCurso) return null;
    consultaEmCurso = true;
    try {
      const res = await controlFetch(`/motor/${piscina.id}/status`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.erro || 'Erro ao consultar o controlador');
      renderizarControle(data);
      return data;
    } finally {
      consultaEmCurso = false;
    }
  }

  window.carregarPainelIoT = async function carregarPainelIoTV3() {
    if (painelOriginal) {
      try { await painelOriginal(); } catch (_) {}
    }
    try {
      await consultarControle();
    } catch (err) {
      console.error('Controle do motor:', err);
    }
  };

  function iniciarConsultaRapida() {
    pararConsultaRapida();
    fastPollStartedAt = Date.now();

    const executar = async () => {
      try {
        const data = await consultarControle();
        if (data?.bloqueio_rearme) {
          pararConsultaRapida();
          return;
        }
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

  function iniciarMonitorContinuo() {
    if (monitorContinuoTimer) return;
    monitorContinuoTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      consultarControle().catch(() => {});
    }, 3000);
  }

  window.enviarComando = async function enviarComandoV3(acao) {
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
        statusEl.textContent = 'COMANDO PENDENTE / CONTROLADOR OFFLINE';
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
    if (texto.includes('SEM COMUNICAÇÃO')) return aplicarEstado('offline');
    if (texto.includes('REARME BLOQUEADO')) return;
    if (texto.includes('MOTOR SEM RETORNO') || texto.includes('MOTOR LIGADO LOCALMENTE')) return;
    if (texto.includes('PENDENTE') || texto.includes('AGUARDANDO') || texto.includes('ENVIANDO')) {
      return aplicarEstado(pendingAction === 'desligar' ? 'stopping' : 'starting');
    }
  });

  observer.observe(statusEl, { childList: true, characterData: true, subtree: true });

  window.addEventListener('beforeunload', () => {
    pararConsultaRapida();
    if (monitorContinuoTimer) clearInterval(monitorContinuoTimer);
  });

  setTimeout(() => {
    window.carregarPainelIoT?.();
    iniciarMonitorContinuo();
  }, 250);
})();