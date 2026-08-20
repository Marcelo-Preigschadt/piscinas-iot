(() => {
  function atualizarRotulosConsumo() {
    const card = document.querySelector('.consumption-card');
    if (!card) return;

    const titulo = card.querySelector('h2');
    if (titulo) titulo.textContent = 'Consumo dos motores';

    const nota = card.querySelector('.card-note');
    if (nota) {
      nota.textContent = 'Estimativa calculada individualmente pela potência cadastrada e pelo tempo real de funcionamento de cada motor. Somente motores efetivamente ligados entram no consumo.';
    }

    const primeiraMetrica = card.querySelector('.consumption-grid .metric span');
    if (primeiraMetrica) primeiraMetrica.textContent = 'Potência em uso';
  }

  function n(v) {
    const x = Number(v || 0);
    return Number.isFinite(x) ? x : 0;
  }

  function consumoDosMotores(base, extraSegundos) {
    const motores = Array.isArray(base?.motores) ? base.motores : [];

    if (!motores.length) {
      const ligado = !!base?.motor_ligado;
      const kw = ligado ? n(base?.potencia_kw) : 0;
      const extra = ligado ? extraSegundos : 0;
      return {
        motoresAtivos: ligado ? 1 : 0,
        nomesAtivos: [],
        potenciaAtivaKw: kw,
        tempoSessao: n(base?.tempo_sessao_segundos) + extra,
        consumoSessao: n(base?.consumo_sessao_kwh) + kw * extra / 3600,
        tempoHoje: n(base?.tempo_hoje_segundos) + extra,
        consumoHoje: n(base?.consumo_hoje_kwh) + kw * extra / 3600,
        tempoMes: n(base?.tempo_mes_segundos) + extra,
        consumoMes: n(base?.consumo_mes_kwh) + kw * extra / 3600
      };
    }

    const total = {
      motoresAtivos: 0,
      nomesAtivos: [],
      potenciaAtivaKw: 0,
      tempoSessao: 0,
      consumoSessao: 0,
      tempoHoje: 0,
      consumoHoje: 0,
      tempoMes: 0,
      consumoMes: 0
    };

    for (const motor of motores) {
      const ligado = !!motor.motor_ligado;
      const kw = n(motor.potencia_kw);
      const extra = ligado ? extraSegundos : 0;

      if (ligado) {
        total.motoresAtivos += 1;
        total.potenciaAtivaKw += kw;
        total.nomesAtivos.push(motor.funcao || motor.nome || `Motor ${motor.canal || ''}`.trim());
      }

      total.tempoSessao += n(motor.tempo_sessao_segundos) + extra;
      total.consumoSessao += n(motor.consumo_sessao_kwh) + kw * extra / 3600;
      total.tempoHoje += n(motor.tempo_hoje_segundos) + extra;
      total.consumoHoje += n(motor.consumo_hoje_kwh) + kw * extra / 3600;
      total.tempoMes += n(motor.tempo_mes_segundos) + extra;
      total.consumoMes += n(motor.consumo_mes_kwh) + kw * extra / 3600;
    }

    return total;
  }

  window.renderizarConsumoTempoReal = function renderizarConsumoTempoRealMultimotor() {
    if (typeof consumoBase === 'undefined' || !consumoBase) return;

    atualizarRotulosConsumo();

    const extraSegundos = Math.max(0, (Date.now() - Number(consumoBaseRecebidoEm || Date.now())) / 1000);
    const total = consumoDosMotores(consumoBase, extraSegundos);

    const potencia = document.getElementById('consumoPotencia');
    const sessao = document.getElementById('consumoSessao');
    const tempoSessaoEl = document.getElementById('tempoSessao');
    const hoje = document.getElementById('consumoHoje');
    const tempoHojeEl = document.getElementById('tempoHoje');
    const mes = document.getElementById('consumoMes');
    const tempoMesEl = document.getElementById('tempoMes');
    const custo = document.getElementById('consumoCustoMes');
    const live = document.getElementById('consumoLive');

    if (potencia) potencia.textContent = `${total.potenciaAtivaKw.toFixed(3).replace('.', ',')} kW`;
    if (sessao) sessao.textContent = formatKwh(total.consumoSessao);
    if (tempoSessaoEl) tempoSessaoEl.textContent = `${formatarTempo(total.tempoSessao)} de operação acumulada`;
    if (hoje) hoje.textContent = formatKwh(total.consumoHoje);
    if (tempoHojeEl) tempoHojeEl.textContent = `${formatarTempo(total.tempoHoje)} de operação acumulada`;
    if (mes) mes.textContent = formatKwh(total.consumoMes);
    if (tempoMesEl) tempoMesEl.textContent = `${formatarTempo(total.tempoMes)} de operação acumulada`;

    const tarifa = consumoBase.tarifa_kwh === null || consumoBase.tarifa_kwh === undefined
      ? null
      : Number(consumoBase.tarifa_kwh);
    if (custo) custo.textContent = tarifa === null ? 'Tarifa não cadastrada' : formatBRL(total.consumoMes * tarifa);

    if (live) {
      if (total.motoresAtivos > 0) {
        live.textContent = total.motoresAtivos === 1 ? '1 motor ligado' : `${total.motoresAtivos} motores ligados`;
        live.title = total.nomesAtivos.join(', ');
        live.classList.add('on');
      } else {
        live.textContent = 'Todos os motores parados';
        live.title = '';
        live.classList.remove('on');
      }
    }
  };

  atualizarRotulosConsumo();
})();
