(() => {
  const CONTROL = 'https://wqjzrbhbkienlxocykcn.supabase.co/functions/v1/piscinas-control';
  const EQUIP = 'https://wqjzrbhbkienlxocykcn.supabase.co/functions/v1/piscinas-equipamentos';
  const perfilAtual = localStorage.getItem('perfil') || 'cliente';
  const isAdmin = perfilAtual === 'admin';

  let motores = [];
  let poolIdAtual = 0;
  let monitorTimer = null;
  let fastTimer = null;
  let fastUntil = 0;
  let requestInFlight = false;
  let editMotorId = null;
  let ultimoStatusGeral = null;

  function getPiscina() {
    try {
      return typeof piscinaSelecionada !== 'undefined' ? piscinaSelecionada : null;
    } catch (_) {
      return null;
    }
  }

  function injectStylesheet() {
    if (document.querySelector('link[data-multi-motors]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/multi-motors.css?v=20260819-1';
    link.dataset.multiMotors = '1';
    document.head.appendChild(link);
  }

  function escapeHtml(v) {
    return String(v ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function numberText(v, suffix = '') {
    if (v === null || v === undefined || v === '') return 'Não informado';
    const n = Number(v);
    if (!Number.isFinite(n)) return 'Não informado';
    return `${String(n).replace('.', ',')}${suffix ? ' ' + suffix : ''}`;
  }

  async function authFetch(base, path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${localStorage.getItem('token') || ''}`);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const res = await fetch(`${base}${path}`, { ...options, headers, cache: 'no-store' });
    if (res.status === 401) {
      if (typeof window.sair === 'function') window.sair();
      throw new Error('Sessão expirada');
    }
    if (res.status === 428) {
      localStorage.setItem('primeiro_acesso', 'true');
      window.location.href = 'senha.html';
      throw new Error('Troca de senha obrigatória');
    }
    return res;
  }

  const equipFetch = (path, options = {}) => authFetch(EQUIP, path, options);
  const controlFetch = (path, options = {}) => authFetch(CONTROL, path, options);

  function pumpMarkup() {
    return `
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
      </div>`;
  }

  function montarEstrutura() {
    injectStylesheet();
    const workspace = document.getElementById('agendaPiscina');
    const dashboard = workspace?.querySelector('.dashboard-grid');
    if (!workspace || !dashboard) return false;

    const legacy = dashboard.querySelector('.motor-control-card');
    if (legacy) {
      legacy.classList.add('legacy-motor-card-hidden');
      legacy.setAttribute('aria-hidden', 'true');
    }

    if (!document.getElementById('multiMotorSection')) {
      const section = document.createElement('section');
      section.id = 'multiMotorSection';
      section.className = 'subcard multi-motor-section';
      section.innerHTML = `
        <div class="multi-motor-heading">
          <div>
            <span class="eyebrow">ACIONAMENTOS</span>
            <h2>Motores da piscina</h2>
            <p>Cadastre até 6 motores e identifique exatamente o que cada um aciona: filtragem, hidro, cascata, aquecimento ou outro circuito.</p>
          </div>
          ${isAdmin ? '<button type="button" id="btnAdicionarMotor" class="btn-primary">+ Adicionar motor</button>' : ''}
        </div>
        <div id="multiMotorStatus" class="multi-motor-status">Carregando motores...</div>
        <div id="multiMotorGrid" class="multi-motor-grid"></div>`;
      dashboard.insertAdjacentElement('beforebegin', section);
      document.getElementById('btnAdicionarMotor')?.addEventListener('click', () => abrirModal());
    }

    if (!document.getElementById('motorEditorModal')) criarModal();
    return true;
  }

  function criarModal() {
    const modal = document.createElement('div');
    modal.id = 'motorEditorModal';
    modal.className = 'multi-motor-modal hidden';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="multi-motor-modal-backdrop" data-close-motor-modal></div>
      <div class="multi-motor-modal-card" role="dialog" aria-modal="true" aria-labelledby="motorModalTitle">
        <div class="multi-motor-modal-head">
          <div><span class="eyebrow">CONFIGURAÇÃO</span><h2 id="motorModalTitle">Adicionar motor</h2></div>
          <button type="button" class="multi-motor-modal-x" data-close-motor-modal aria-label="Fechar">×</button>
        </div>
        <div class="multi-motor-form-grid">
          <div class="field-group field-wide">
            <label for="mmFuncao">O que este motor aciona</label>
            <input id="mmFuncao" list="mmFuncoes" placeholder="Ex.: Filtragem, Hidro, Cascata" maxlength="120" required>
            <datalist id="mmFuncoes">
              <option value="Filtragem"><option value="Hidromassagem"><option value="Cascata"><option value="Aquecimento"><option value="Borda infinita"><option value="Fonte"><option value="Spa"><option value="Outro">
            </datalist>
          </div>
          <div class="field-group"><label for="mmNome">Nome/identificação</label><input id="mmNome" placeholder="Ex.: Motor hidro adulto" maxlength="120"></div>
          <div class="field-group"><label for="mmFabricante">Fabricante</label><input id="mmFabricante" placeholder="Ex.: WEG" maxlength="120"></div>
          <div class="field-group"><label for="mmModelo">Modelo</label><input id="mmModelo" placeholder="Ex.: W22" maxlength="120"></div>
          <div class="field-group"><label for="mmPotenciaCv">Potência nominal (CV)</label><input type="number" id="mmPotenciaCv" min="0" step="0.01"></div>
          <div class="field-group"><label for="mmPotenciaW">Potência elétrica (W)</label><input type="number" id="mmPotenciaW" min="0" step="1"></div>
          <div class="field-group"><label for="mmTensao">Tensão (V)</label><input type="number" id="mmTensao" min="0" step="1"></div>
          <div class="field-group"><label for="mmCorrente">Corrente nominal (A)</label><input type="number" id="mmCorrente" min="0" step="0.01"></div>
          <div class="field-group field-wide"><label for="mmObs">Observações</label><input id="mmObs" placeholder="Ex.: aciona a bomba da hidromassagem da piscina infantil" maxlength="500"></div>
        </div>
        <div id="motorModalStatus" class="multi-motor-modal-status"></div>
        <div class="multi-motor-modal-actions">
          <button type="button" class="btn-secondary" data-close-motor-modal>Cancelar</button>
          <button type="button" id="btnSalvarMultiMotor" class="btn-primary">Salvar motor</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-close-motor-modal]').forEach(el => el.addEventListener('click', fecharModal));
    document.getElementById('btnSalvarMultiMotor')?.addEventListener('click', salvarMotor);
  }

  function abrirModal(motor = null) {
    if (!isAdmin) return;
    if (!motor && motores.length >= 6) {
      alert('Esta piscina já possui o limite de 6 motores.');
      return;
    }
    editMotorId = motor ? Number(motor.id) : null;
    document.getElementById('motorModalTitle').textContent = motor ? `Editar Motor ${motor.canal}` : 'Adicionar motor';
    document.getElementById('mmFuncao').value = motor?.funcao || '';
    document.getElementById('mmNome').value = motor?.nome || '';
    document.getElementById('mmFabricante').value = motor?.fabricante || '';
    document.getElementById('mmModelo').value = motor?.modelo || '';
    document.getElementById('mmPotenciaCv').value = motor?.potencia_cv ?? '';
    document.getElementById('mmPotenciaW').value = motor?.potencia_eletrica_w ?? '';
    document.getElementById('mmTensao').value = motor?.tensao_v ?? '';
    document.getElementById('mmCorrente').value = motor?.corrente_nominal_a ?? '';
    document.getElementById('mmObs').value = motor?.observacoes || '';
    document.getElementById('motorModalStatus').textContent = '';
    const modal = document.getElementById('motorEditorModal');
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    setTimeout(() => document.getElementById('mmFuncao')?.focus(), 80);
  }

  function fecharModal() {
    const modal = document.getElementById('motorEditorModal');
    modal?.classList.add('hidden');
    modal?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    editMotorId = null;
  }

  function valueNum(id) {
    const v = document.getElementById(id).value.trim();
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  async function salvarMotor() {
    const piscina = getPiscina();
    if (!piscina || !isAdmin) return;
    const funcao = document.getElementById('mmFuncao').value.trim();
    const status = document.getElementById('motorModalStatus');
    if (!funcao) {
      status.textContent = 'Informe o que este motor aciona.';
      status.classList.add('error');
      return;
    }
    const payload = {
      funcao,
      nome: document.getElementById('mmNome').value.trim(),
      fabricante: document.getElementById('mmFabricante').value.trim(),
      modelo: document.getElementById('mmModelo').value.trim(),
      potencia_cv: valueNum('mmPotenciaCv'),
      potencia_eletrica_w: valueNum('mmPotenciaW'),
      tensao_v: valueNum('mmTensao'),
      corrente_nominal_a: valueNum('mmCorrente'),
      observacoes: document.getElementById('mmObs').value.trim()
    };
    const btn = document.getElementById('btnSalvarMultiMotor');
    btn.disabled = true;
    status.classList.remove('error');
    status.textContent = 'Salvando...';
    try {
      const path = editMotorId
        ? `/piscinas/${piscina.id}/motores/${editMotorId}`
        : `/piscinas/${piscina.id}/motores`;
      const res = await equipFetch(path, { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.erro || 'Erro ao salvar motor');
      status.textContent = 'Motor salvo.';
      await carregarMotores(true);
      setTimeout(fecharModal, 350);
    } catch (err) {
      status.classList.add('error');
      status.textContent = err.message || 'Erro ao salvar motor';
    } finally {
      btn.disabled = false;
    }
  }

  async function excluirMotor(motor) {
    if (!isAdmin) return;
    if (Number(motor.canal) === 1) {
      alert('O Motor 1 é o canal principal. Edite a função dele em vez de excluir.');
      return;
    }
    if (!confirm(`Excluir o Motor ${motor.canal} — ${motor.funcao}?`)) return;
    const piscina = getPiscina();
    if (!piscina) return;
    try {
      const res = await equipFetch(`/piscinas/${piscina.id}/motores/${motor.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.erro || 'Erro ao excluir motor');
      await carregarMotores(true);
    } catch (err) {
      alert(err.message || 'Erro ao excluir motor');
    }
  }

  function specResumo(m) {
    const parts = [];
    if (m.fabricante) parts.push(escapeHtml(m.fabricante));
    if (m.modelo) parts.push(escapeHtml(m.modelo));
    if (m.potencia_cv !== null && m.potencia_cv !== undefined) parts.push(`${escapeHtml(String(m.potencia_cv).replace('.', ','))} CV`);
    if (m.potencia_eletrica_w !== null && m.potencia_eletrica_w !== undefined) parts.push(`${escapeHtml(String(m.potencia_eletrica_w).replace('.', ','))} W`);
    return parts.length ? parts.join(' • ') : 'Dados elétricos ainda não cadastrados';
  }

  function motorCard(m) {
    const canDelete = isAdmin && Number(m.canal) !== 1;
    return `
      <article class="multi-motor-card" data-motor-id="${Number(m.id)}" data-canal="${Number(m.canal)}">
        <div class="multi-motor-card-head">
          <div>
            <span class="multi-motor-channel">MOTOR ${Number(m.canal)}</span>
            <h3>${escapeHtml(m.funcao || `Motor ${m.canal}`)}</h3>
            <p>${escapeHtml(m.nome || `Canal ${m.canal}`)}</p>
          </div>
          <span class="multi-motor-state-chip" data-role="chip">VERIFICANDO</span>
        </div>
        <div class="multi-motor-spec-line">${specResumo(m)}</div>

        <div class="motor-visual is-stopped" data-role="visual">
          <div class="motor-visual-head">
            <span class="motor-visual-label">${escapeHtml(m.funcao || 'Motor')}</span>
            <strong class="motor-visual-state" data-role="visual-state">Motor parado</strong>
          </div>
          ${pumpMarkup()}
          <div class="motor-visual-hint" data-role="visual-hint">Pronto para acionamento</div>
        </div>

        <div class="motor-diagnostics" aria-label="Diagnóstico do acionamento">
          <div class="motor-diag-item"><span>Relé remoto</span><strong data-role="relay">--</strong></div>
          <div class="motor-diag-item"><span>Retorno do motor</span><strong data-role="return">--</strong></div>
          <div class="motor-diag-item motor-diag-wide"><span>Segurança</span><strong data-role="safety">Verificando...</strong></div>
        </div>

        <div class="motor-buttons multi-motor-buttons">
          <button type="button" class="ligar" data-action="ligar">Ligar</button>
          <button type="button" class="desligar" data-action="desligar">Desligar</button>
        </div>

        <div class="multi-motor-details">
          <span><strong>Tensão</strong>${escapeHtml(numberText(m.tensao_v, 'V'))}</span>
          <span><strong>Corrente</strong>${escapeHtml(numberText(m.corrente_nominal_a, 'A'))}</span>
        </div>
        ${m.observacoes ? `<div class="multi-motor-note">${escapeHtml(m.observacoes)}</div>` : ''}
        ${isAdmin ? `<div class="multi-motor-admin-actions"><button type="button" class="btn-secondary" data-edit-motor>Editar</button>${canDelete ? '<button type="button" class="btn-danger-light" data-delete-motor>Excluir</button>' : ''}</div>` : ''}
      </article>`;
  }

  function bindCards() {
    document.querySelectorAll('.multi-motor-card').forEach(card => {
      const id = Number(card.dataset.motorId);
      const motor = motores.find(m => Number(m.id) === id);
      if (!motor) return;
      card.querySelector('[data-action="ligar"]')?.addEventListener('click', () => enviarComando(motor, 'ligar'));
      card.querySelector('[data-action="desligar"]')?.addEventListener('click', () => enviarComando(motor, 'desligar'));
      card.querySelector('[data-edit-motor]')?.addEventListener('click', () => abrirModal(motor));
      card.querySelector('[data-delete-motor]')?.addEventListener('click', () => excluirMotor(motor));
    });
  }

  function renderMotores() {
    const grid = document.getElementById('multiMotorGrid');
    const status = document.getElementById('multiMotorStatus');
    const add = document.getElementById('btnAdicionarMotor');
    if (!grid || !status) return;
    if (!motores.length) {
      grid.innerHTML = '<div class="multi-motor-empty">Nenhum motor cadastrado nesta piscina.</div>';
      status.textContent = isAdmin ? 'Use “Adicionar motor” para cadastrar o primeiro acionamento.' : 'Nenhum acionamento configurado.';
    } else {
      grid.innerHTML = motores.map(motorCard).join('');
      status.textContent = `${motores.length} de 6 motores cadastrados`;
      bindCards();
    }
    if (add) {
      add.disabled = motores.length >= 6;
      add.textContent = motores.length >= 6 ? 'Limite de 6 motores' : '+ Adicionar motor';
    }
  }

  async function carregarMotores(force = false) {
    if (!montarEstrutura()) return;
    const piscina = getPiscina();
    if (!piscina?.id) return;
    const novoId = Number(piscina.id);
    if (!force && poolIdAtual === novoId && motores.length) return;
    poolIdAtual = novoId;
    const status = document.getElementById('multiMotorStatus');
    if (status) status.textContent = 'Carregando motores...';
    try {
      const res = await equipFetch(`/piscinas/${novoId}/motores`);
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data.erro || 'Erro ao carregar motores');
      motores = Array.isArray(data) ? data : [];
      renderMotores();
      await consultarStatus();
    } catch (err) {
      if (status) status.textContent = err.message || 'Erro ao carregar motores';
    }
  }

  function setDiag(el, text, cls = '') {
    if (!el) return;
    el.textContent = text;
    const item = el.closest('.motor-diag-item');
    item?.classList.remove('is-ok', 'is-warn', 'is-fault', 'is-stale');
    if (cls) item?.classList.add(cls);
  }

  function setVisual(card, state, title, hint) {
    const visual = card.querySelector('[data-role="visual"]');
    const stateEl = card.querySelector('[data-role="visual-state"]');
    const hintEl = card.querySelector('[data-role="visual-hint"]');
    visual?.classList.remove('is-stopped', 'is-running', 'is-starting', 'is-stopping', 'is-offline', 'is-disconnected');
    visual?.classList.add(`is-${state}`);
    if (stateEl) stateEl.textContent = title;
    if (hintEl) hintEl.textContent = hint;
  }

  function motivoBloqueio(motivo) {
    const map = {
      retorno_perdido: 'Retorno perdido durante o funcionamento',
      sem_retorno_apos_comando: 'Motor não confirmou a partida',
      motor_permanece_ligado: 'Motor continuou ativo após desligamento'
    };
    return map[motivo] || 'Falha/intervenção local detectada';
  }

  function renderStatusMotor(data, geral) {
    const card = document.querySelector(`.multi-motor-card[data-motor-id="${Number(data.id)}"]`);
    if (!card) return;
    const chip = card.querySelector('[data-role="chip"]');
    const relay = card.querySelector('[data-role="relay"]');
    const ret = card.querySelector('[data-role="return"]');
    const safety = card.querySelector('[data-role="safety"]');
    const btnOn = card.querySelector('[data-action="ligar"]');
    const btnOff = card.querySelector('[data-action="desligar"]');
    const stale = geral.status !== 'online';
    const prefix = stale ? 'ÚLTIMO: ' : '';

    if (chip) {
      chip.className = `multi-motor-state-chip ${geral.status}`;
      chip.textContent = geral.status === 'online' ? (data.motor === 'ligado' ? 'LIGADO' : 'DESLIGADO') : geral.status.toUpperCase();
    }

    setDiag(relay, data.rele === 'ligado' ? `${prefix}LIGADO` : `${prefix}DESLIGADO`, stale ? 'is-stale' : (data.rele === 'ligado' ? 'is-ok' : ''));
    setDiag(ret, data.motor === 'ligado' ? `${prefix}LIGADO` : `${prefix}DESLIGADO`, stale ? 'is-stale' : (data.motor === 'ligado' ? 'is-ok' : ''));

    if (data.bloqueio_rearme) {
      setDiag(safety, `BLOQUEADO — ${motivoBloqueio(data.motivo_bloqueio)}`, 'is-fault');
      setVisual(card, data.motor === 'ligado' ? 'running' : 'stopped', data.motor === 'ligado' ? 'Motor ligado localmente' : 'Motor desligado por segurança', motivoBloqueio(data.motivo_bloqueio));
    } else if (stale) {
      setDiag(safety, 'ESTADO NÃO ATUALIZADO', 'is-stale');
      setVisual(card, 'offline', 'Controlador sem comunicação', 'Aguardando novo heartbeat do ESP32');
    } else if (data.pendente) {
      setDiag(safety, 'AGUARDANDO CONFIRMAÇÃO', 'is-warn');
      setVisual(card, data.comando === 'desligar' ? 'stopping' : 'starting', data.comando === 'desligar' ? 'Desligando bomba…' : 'Acionando bomba…', 'Aguardando retorno físico deste motor');
    } else if (data.rele !== data.motor) {
      setDiag(safety, data.rele === 'ligado' ? 'SEM RETORNO DO MOTOR' : 'MOTOR LIGADO LOCALMENTE', 'is-warn');
      if (data.motor === 'ligado') setVisual(card, 'running', 'Motor ligado localmente', 'Retorno físico ativo sem relé remoto');
      else setVisual(card, 'stopped', 'Motor sem retorno', 'Relé remoto ligado, mas sem confirmação física');
    } else {
      setDiag(safety, 'NORMAL', 'is-ok');
      if (data.motor === 'ligado') setVisual(card, 'running', 'Bomba em funcionamento', `Acionamento: ${data.funcao || 'motor'}`);
      else setVisual(card, 'stopped', 'Motor parado', `Pronto para acionar ${data.funcao || 'motor'}`);
    }

    const fw = String(geral.firmware_version || '');
    const multiFirmware = /^1\.(?:[3-9]|\d{2,})\./.test(fw) || /^([2-9]|\d{2,})\./.test(fw);
    const canalSemFirmware = Number(data.canal) > 1 && fw && !multiFirmware;
    if (btnOn) btnOn.disabled = geral.status === 'offline' || canalSemFirmware;
    if (btnOff) btnOff.disabled = geral.status === 'offline' || canalSemFirmware;
    if (canalSemFirmware) {
      setDiag(safety, `AGUARDANDO FIRMWARE MULTIMOTOR — atual ${fw}`, 'is-stale');
    }
  }

  function renderStatusGeral(data) {
    ultimoStatusGeral = data;
    const status = document.getElementById('multiMotorStatus');
    if (!data || data.status === 'sem_controlador') {
      if (status) status.textContent = 'Piscina sem controlador ESP32 vinculado.';
      motores.forEach(m => {
        const card = document.querySelector(`.multi-motor-card[data-motor-id="${Number(m.id)}"]`);
        if (card) setVisual(card, 'disconnected', 'Sem controlador', 'Vincule um ESP32 para controlar os motores');
      });
      return;
    }
    const connectionText = data.status === 'online' ? 'Controlador online' : data.status === 'instavel' ? 'Conexão instável' : 'Controlador offline';
    const fw = data.firmware_version ? ` • Firmware ${data.firmware_version}` : '';
    const wifi = data.status === 'online' && data.wifi_ssid ? ` • Wi-Fi ${data.wifi_ssid}` : '';
    if (status) status.textContent = `${motores.length} de 6 motores cadastrados • ${connectionText}${fw}${wifi}`;
    (data.motores || []).forEach(m => renderStatusMotor(m, data));
  }

  async function consultarStatus() {
    const piscina = getPiscina();
    if (!piscina?.id || requestInFlight) return null;
    requestInFlight = true;
    try {
      const res = await controlFetch(`/motores/${piscina.id}/status`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.erro || 'Erro ao consultar motores');
      renderStatusGeral(data);
      return data;
    } catch (err) {
      const status = document.getElementById('multiMotorStatus');
      if (status) status.textContent = err.message || 'Erro de comunicação com os motores';
      return null;
    } finally {
      requestInFlight = false;
    }
  }

  function iniciarFastPoll() {
    if (fastTimer) clearInterval(fastTimer);
    fastUntil = Date.now() + 15000;
    consultarStatus();
    fastTimer = setInterval(async () => {
      const data = await consultarStatus();
      const aindaPendente = (data?.motores || []).some(m => m.pendente);
      if (!aindaPendente || Date.now() >= fastUntil) {
        clearInterval(fastTimer);
        fastTimer = null;
      }
    }, 500);
  }

  async function enviarComando(motor, acao) {
    const piscina = getPiscina();
    if (!piscina?.id) return;
    const card = document.querySelector(`.multi-motor-card[data-motor-id="${Number(motor.id)}"]`);
    if (card) setVisual(card, acao === 'desligar' ? 'stopping' : 'starting', acao === 'desligar' ? 'Desligando bomba…' : 'Acionando bomba…', 'Enviando comando ao ESP32');
    try {
      const res = await controlFetch(`/motor/${piscina.id}/${motor.id}/${acao}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.erro || `Falha ao ${acao} motor`);
      iniciarFastPoll();
    } catch (err) {
      alert(err.message || 'Erro ao enviar comando');
      consultarStatus();
    }
  }

  function observarPiscina() {
    const check = async () => {
      const piscina = getPiscina();
      if (!piscina?.id) return;
      if (Number(piscina.id) !== poolIdAtual) {
        motores = [];
        poolIdAtual = 0;
        await carregarMotores(true);
      }
    };
    setInterval(check, 900);
  }

  function iniciarMonitor() {
    if (monitorTimer) clearInterval(monitorTimer);
    monitorTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const piscina = getPiscina();
      if (!piscina?.id) return;
      if (!motores.length) carregarMotores(true);
      else consultarStatus();
    }, 3000);
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('motorEditorModal')?.classList.contains('hidden')) fecharModal();
  });

  window.addEventListener('beforeunload', () => {
    if (monitorTimer) clearInterval(monitorTimer);
    if (fastTimer) clearInterval(fastTimer);
  });

  const boot = () => {
    if (!montarEstrutura()) return setTimeout(boot, 200);
    observarPiscina();
    iniciarMonitor();
    setTimeout(() => carregarMotores(true), 250);
  };
  boot();
})();
