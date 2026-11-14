/**
 * Módulo Biofísico-Probabilístico, Planejador por Data e Cenários ENSO (AgroShield)
 * Extraído para backend/services/biophys.js para modularidade e testabilidade.
 */

const memoriaTalhoes = new Map();

function obterChaveTalhao(centroid) {
  if (!centroid || typeof centroid.lat !== 'number' || typeof centroid.lng !== 'number') {
    return 'talhao_padrao';
  }
  return `${centroid.lat.toFixed(3)}_${centroid.lng.toFixed(3)}`;
}

/**
 * Atualiza e persiste o vetor de memória agrícola R_t = (Rres, RN, RC, Rroot, Rpath)
 * usando a recorrência R_{k,t+1} = rho_k * R_{k,t} + G_k(C_t, M_t, Z_t).
 */
function atualizarMemoriaAgricola(fieldReq, nasaMetrics, opcoes = {}) {
  const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
  const round2 = (v) => Number(v.toFixed(2));

  const rotacao = String(fieldReq.currentRotation || `${fieldReq.crop} → Milho Safrinha`);
  const temGraminea = /\b(milho|trigo|braqui|aveia|sorgo|cana)\b/i.test(rotacao);
  const temLeguminosa = /\b(soja|feij|amendoim|crotal)\b/i.test(rotacao);
  const monocultura = !(temGraminea && temLeguminosa) && rotacao.split(/→|->|\/|,/).length < 2;

  const rho = { res: 0.72, N: 0.55, C: 0.85, root: 0.65, path: 0.60 };
  const chuvaMm = Number(nasaMetrics?.predictedRain ?? 0);
  const fatorLavagemN = chuvaMm > 45 ? 0.08 : 0;

  const gRes = temGraminea ? 0.34 : 0.16;
  const gN = Math.max(0.05, (temLeguminosa ? 0.38 : 0.12) - fatorLavagemN);
  const gC = temGraminea ? 0.20 : 0.10;
  const gRoot = temGraminea && temLeguminosa ? 0.32 : 0.18;
  const gPath = monocultura ? 0.42 : 0.14;

  const chave = obterChaveTalhao(fieldReq.centroid);
  const anterior =
    !opcoes.stateless && memoriaTalhoes.has(chave)
      ? memoriaTalhoes.get(chave)
      : {
          residuosRres: 0.55,
          nitrogenioRN: 0.45,
          carbonoRC: 0.68,
          raizesRroot: 0.52,
          patogenosRpath: 0.48,
          ciclosRegistrados: 0,
        };

  const atualizado = {
    residuosRres: round2(clamp01(rho.res * anterior.residuosRres + gRes)),
    nitrogenioRN: round2(clamp01(rho.N * anterior.nitrogenioRN + gN)),
    carbonoRC: round2(clamp01(rho.C * anterior.carbonoRC + gC)),
    raizesRroot: round2(clamp01(rho.root * anterior.raizesRroot + gRoot)),
    patogenosRpath: round2(clamp01(rho.path * anterior.patogenosRpath + gPath)),
    rotacaoDetectada: rotacao,
    ciclosRegistrados: (anterior.ciclosRegistrados || 0) + 1,
  };

  if (!opcoes.stateless && fieldReq.centroid) {
    memoriaTalhoes.set(chave, atualizado);
  }
  return atualizado;
}

/**
 * Avaliador Determinístico da Operação Planejada (100% fora da IA):
 * Cruza Operação (Plantar/Pulverizar/Adubar/Colher) + Data escolhida + Solo + Manual Oficial Regional
 * e informa claramente a % de acerto/confiança da previsão para aquele horizonte.
 */
function avaliarOperacaoPlanejada(fieldReq, nasaMetrics, regiao) {
  const operacao = fieldReq.plannedOperation || 'Pulverizar';
  const hoje = new Date();
  const hojeUtc = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
  const dataAlvoStr = fieldReq.plannedDate || new Date(hojeUtc).toISOString().slice(0, 10);
  const [ano, mes, dia] = dataAlvoStr.split('-').map(Number);
  const alvoUtc = Date.UTC(ano, (mes || 1) - 1, dia || 1);
  const diasAteAcao = Math.max(0, Math.round((alvoUtc - hojeUtc) / (24 * 60 * 60 * 1000)));

  const lim = regiao.limites;
  const raizPct = nasaMetrics.rootZoneMoisture ?? nasaMetrics.soilMoisture;
  const supPct = nasaMetrics.soilMoisture;
  const tempSolo = nasaMetrics.soilTempC;
  const soloDesc = nasaMetrics.soilGrids
    ? `${nasaMetrics.soilGrids.classeTextural} (${nasaMetrics.soilGrids.argilaPct}% argila, pH ${nasaMetrics.soilGrids.ph})`
    : regiao.solo;

  let precisaoPrevisaoPct = 90;
  let horizonteDescricao = 'Previsão imediata (0–2 dias): NASA + Open-Meteo em tempo real';
  let chuvaRef = nasaMetrics.predictedRain;
  let ventoRef = nasaMetrics.ventoKmh ?? Number((nasaMetrics.windSpeed2m * 3.6).toFixed(1));

  if (diasAteAcao >= 2 && diasAteAcao <= 7) {
    precisaoPrevisaoPct = Math.max(72, 84 - diasAteAcao * 2);
    horizonteDescricao = `Janela de ${diasAteAcao} dias: Open-Meteo diário + Cadeia de Markov NASA`;
    const prevDia = nasaMetrics.forecastPorData?.[dataAlvoStr];
    if (prevDia) {
      if (typeof prevDia.chuvaMm === 'number') chuvaRef = prevDia.chuvaMm;
      if (typeof prevDia.vento2mKmh === 'number') ventoRef = prevDia.vento2mKmh;
    }
  } else if (diasAteAcao >= 8 && diasAteAcao <= 14) {
    precisaoPrevisaoPct = nasaMetrics.ensemble14d?.confiancaConsensoPct
      ? Math.min(76, Math.max(60, Math.round(nasaMetrics.ensemble14d.confiancaConsensoPct * 0.78)))
      : 66;
    horizonteDescricao = `2ª semana (${diasAteAcao} dias): Tendência por 31 cenários (Ensemble) + Markov`;
    if (nasaMetrics.ensemble14d) {
      chuvaRef = Math.round(nasaMetrics.ensemble14d.chuvaMedianaSemana2Mm / 3);
    }
  } else if (diasAteAcao > 14) {
    precisaoPrevisaoPct = 55;
    horizonteDescricao = `Longo prazo (${diasAteAcao} dias): Climatologia histórica NASA + Manual ZARC (sem previsão diária exata)`;
  }

  let veredito = 'LIBERADA';
  let recomendacao = '';

  if (operacao === 'Pulverizar') {
    if (diasAteAcao > 7) {
      veredito = nasaMetrics.ensemble14d?.tendenciaSemana2 === 'CHUVOSA' ? 'ATENCAO' : 'LIBERADA';
      recomendacao = `Para pulverizar ${fieldReq.crop} em ${diasAteAcao} dias, a tendência aponta ${nasaMetrics.ensemble14d?.tendenciaSemana2 === 'CHUVOSA' ? 'semana chuvosa' : 'janela mais firme'}, mas vento horário só é confiável a partir de 3–5 dias antes (${regiao.fonte}: limite ${lim.ventoDerivaKmh} km/h).`;
    } else if (ventoRef > lim.ventoDerivaKmh || chuvaRef >= lim.chuvaRedMm) {
      veredito = 'NAO_RECOMENDADA';
      recomendacao = `Não pulverizar ${fieldReq.crop} em ${dataAlvoStr}: vento de ${ventoRef} km/h (limite do manual ${regiao.fonte}: ${lim.ventoDerivaKmh} km/h) ou chuva de ${chuvaRef} mm causam deriva e lavagem do produto.`;
    } else if (typeof tempSolo === 'number' && tempSolo >= 35) {
      veredito = 'ATENCAO';
      recomendacao = `Atenção ao pulverizar ${fieldReq.crop}: solo a ${tempSolo}°C aumenta evaporação/volatilização. Prefira início da manhã ou fim da tarde (${regiao.fonte}).`;
    } else {
      veredito = 'LIBERADA';
      recomendacao = `Janela favorável para pulverizar ${fieldReq.crop} em ${dataAlvoStr}: vento (${ventoRef} km/h) e chuva (${chuvaRef} mm) dentro dos limites de ${regiao.fonte}.`;
    }
  } else if (operacao === 'Plantar') {
    if (chuvaRef >= lim.chuvaRedMm || raizPct >= lim.umidadeRedPct || (chuvaRef >= 15 && raizPct >= 74)) {
      veredito = 'NAO_RECOMENDADA';
      recomendacao = `Adie o plantio de ${fieldReq.crop} em ${dataAlvoStr}: solo saturado na raiz (${raizPct}% SMAP) com ${chuvaRef} mm previstos gera atolamento da plantadeira e compactação em ${soloDesc} (${regiao.fonte}).`;
    } else if (typeof tempSolo === 'number' && tempSolo < 15) {
      veredito = 'ATENCAO';
      recomendacao = `Solo frio (${tempSolo}°C) em ${soloDesc}: pode atrasar a germinação de ${fieldReq.crop}. Avalie vigor da semente conforme ${regiao.fonte}.`;
    } else if (raizPct < 35 && chuvaRef < 5) {
      veredito = 'ATENCAO';
      recomendacao = `Solo seco na zona das raízes (${raizPct}% SMAP) sem chuva prevista (${chuvaRef} mm): risco de falha de emergência de ${fieldReq.crop} (${regiao.fonte}).`;
    } else {
      veredito = 'LIBERADA';
      recomendacao = `Condição adequada de plantio para ${fieldReq.crop} em ${dataAlvoStr}: umidade na raiz (${raizPct}% SMAP)${typeof tempSolo === 'number' ? ` e solo a ${tempSolo}°C` : ''} permitem boa semeadura em ${soloDesc} (${regiao.fonte}).`;
    }
  } else if (operacao === 'Adubar') {
    if (chuvaRef >= lim.chuvaRedMm || supPct >= lim.umidadeRedPct) {
      veredito = 'NAO_RECOMENDADA';
      recomendacao = `Não adubar ${fieldReq.crop} em ${dataAlvoStr}: chuva de ${chuvaRef} mm supera o limite de ${lim.chuvaRedMm} mm (${regiao.fonte}), causando lixiviação do fertilizante e compactação em ${soloDesc}.`;
    } else if (chuvaRef >= lim.chuvaRedMm * 0.7) {
      veredito = 'ATENCAO';
      recomendacao = `Cuidado ao adubar ${fieldReq.crop} em ${dataAlvoStr}: volume de ${chuvaRef} mm próximo do limite (${lim.chuvaRedMm} mm) pode carrear nutrientes em ${soloDesc} (${regiao.fonte}).`;
    } else {
      veredito = 'LIBERADA';
      recomendacao = `Adubação liberada para ${fieldReq.crop} em ${dataAlvoStr}: umidade equilibrada (${supPct}% sup. / ${raizPct}% raiz) sem risco de lavagem severa (${regiao.fonte}).`;
    }
  } else {
    if (chuvaRef >= 20 || supPct >= lim.umidadeRedPct || raizPct >= 82) {
      veredito = 'NAO_RECOMENDADA';
      recomendacao = `Suspenda a colheita de ${fieldReq.crop} em ${dataAlvoStr}: ${chuvaRef} mm previstos e solo úmido (${raizPct}% na raiz) elevam risco de grão ardido e atolamento da colheitadeira em ${soloDesc} (${regiao.fonte}).`;
    } else if (chuvaRef >= 8 || supPct >= 70) {
      veredito = 'ATENCAO';
      recomendacao = `Colheita com cautela em ${dataAlvoStr}: umidade superficial (${supPct}%) e chuva de ${chuvaRef} mm exigem conferir umidade dos grãos antes de entrar (${regiao.fonte}).`;
    } else {
      veredito = 'LIBERADA';
      recomendacao = `Janela boa para colher ${fieldReq.crop} em ${dataAlvoStr}: solo firme (${raizPct}% na raiz) e baixa chuva (${chuvaRef} mm) segundo ${regiao.fonte}.`;
    }
  }

  return {
    operacao,
    data: dataAlvoStr,
    diasAteAcao,
    veredito,
    precisaoPrevisaoPct,
    horizonteDescricao,
    soloAnalisado: `${soloDesc} · Sup. ${supPct}% · Raiz SMAP ${raizPct}%${typeof tempSolo === 'number' ? ` · ${tempSolo}°C` : ''}`,
    recomendacao,
    fonteOficial: `${regiao.fonte} (${regiao.uf})`,
  };
}

/**
 * Modulação hidrológica e térmica determinística para cenários ENSO (El Niño / La Niña).
 */
function aplicarCenarioClimatico(nasaBruto, climateScenario, uf = 'PR') {
  if (!nasaBruto || !climateScenario || climateScenario === 'current') return nasaBruto;
  const regiaoSul = ['PR', 'SUL_RS_SC', 'AR_PAMPAS'].includes(uf);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  if (climateScenario === 'el-nino-2023-24') {
    const fatorChuva = regiaoSul ? 1.35 : 0.75;
    const deltaUmid = regiaoSul ? 10 : -8;
    const deltaTemp = regiaoSul ? 0.5 : 2.8;
    return {
      ...nasaBruto,
      predictedRain: Math.round(Math.max(0, (nasaBruto.predictedRain || 0) * fatorChuva)),
      soilMoisture: Math.round(clamp((nasaBruto.soilMoisture ?? 50) + deltaUmid, 10, 98)),
      smapRootWetness: Math.round(
        clamp((nasaBruto.smapRootWetness ?? nasaBruto.soilMoisture ?? 50) + deltaUmid, 10, 98)
      ),
      soilTempC:
        typeof nasaBruto.soilTempC === 'number'
          ? Number((nasaBruto.soilTempC + deltaTemp).toFixed(1))
          : nasaBruto.soilTempC,
    };
  }

  if (climateScenario === 'la-nina-2021-22') {
    const fatorChuva = regiaoSul ? 0.7 : 1.25;
    const deltaUmid = regiaoSul ? -12 : 8;
    const deltaTemp = regiaoSul ? 2.4 : -0.5;
    return {
      ...nasaBruto,
      predictedRain: Math.round(Math.max(0, (nasaBruto.predictedRain || 0) * fatorChuva)),
      soilMoisture: Math.round(clamp((nasaBruto.soilMoisture ?? 50) + deltaUmid, 10, 98)),
      smapRootWetness: Math.round(
        clamp((nasaBruto.smapRootWetness ?? nasaBruto.soilMoisture ?? 50) + deltaUmid, 10, 98)
      ),
      soilTempC:
        typeof nasaBruto.soilTempC === 'number'
          ? Number((nasaBruto.soilTempC + deltaTemp).toFixed(1))
          : nasaBruto.soilTempC,
    };
  }

  return nasaBruto;
}

/**
 * Núcleo Biofísico-Probabilístico (POMDP + Memória Agrícola Rt + Crença HMM bt)
 */
function avaliarModeloBiofisicoProbabilistico(fieldReq, nasaMetrics, regiao, opcoes = {}) {
  const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
  const round2 = (v) => Number(v.toFixed(2));

  const Rt = atualizarMemoriaAgricola(fieldReq, nasaMetrics, {
    stateless: opcoes.stateless ?? !fieldReq.centroid,
  });

  const supPct = Number(nasaMetrics.soilMoisture ?? 50);
  const raizPct = Number(nasaMetrics.smapRootWetness ?? supPct);
  const argilaPct = Number(nasaMetrics.soilGrids?.argilaPct ?? 35);
  const tempSolo = Number(nasaMetrics.soilTempC ?? 24);
  const chuvaMm = Number(nasaMetrics.predictedRain ?? 0);
  const ventoKmh = Number(nasaMetrics.ventoKmh ?? 0);

  const Wt = round2(clamp01((supPct * 0.4 + raizPct * 0.6) / 100));
  const infiltracaoEstimadaMmH = Number(
    Math.max(
      4,
      Math.min(
        48,
        (1 - argilaPct / 130) * 28 + Rt.residuosRres * 14 + Rt.raizesRroot * 8 - Wt * 12
      )
    ).toFixed(1)
  );
  const socBase =
    typeof nasaMetrics.soilGrids?.socGKg === 'number'
      ? clamp01(nasaMetrics.soilGrids.socGKg / 45)
      : typeof nasaMetrics.soilGrids?.ph === 'number'
        ? 0.52
        : 0.48;
  const SOCt = round2(clamp01(socBase * 0.55 + Rt.carbonoRC * 0.45));
  const fatorTermicoUmido = Wt > 0.65 && tempSolo >= 20 && tempSolo <= 32 ? 0.35 : 0.15;
  const Dt = round2(clamp01(Rt.patogenosRpath * 0.6 + fatorTermicoUmido));

  const Xt = {
    disponibilidadeHidricaPct: Math.round(Wt * 100),
    infiltracaoEstimadaMmH,
    carbonoOrganicoIdx: SOCt,
    pressaoFitossanitariaPct: Math.round(Dt * 100),
  };

  const riscoChuva = chuvaMm / Math.max(15, regiao?.limites?.chuvaRedMm || 40);
  const scoreSeco = Math.max(0.05, (1 - Wt) * 1.4 - riscoChuva * 0.5);
  const scoreSaturado = Math.max(0.05, Wt * 1.35 + riscoChuva * 0.85 - infiltracaoEstimadaMmH / 60);
  const scoreIdeal = Math.max(0.05, 1.25 - Math.abs(Wt - 0.55) * 2.1 - Math.max(0, riscoChuva - 0.5) * 0.7);
  const somaB = scoreSeco + scoreIdeal + scoreSaturado;

  const bt = {
    seco: Math.round((scoreSeco / somaB) * 100),
    ideal: Math.round((scoreIdeal / somaB) * 100),
    saturado: 0,
  };
  bt.saturado = Math.max(0, 100 - bt.seco - bt.ideal);

  const regimeDominante =
    bt.saturado >= bt.ideal && bt.saturado >= bt.seco
      ? 'SATURADO_ESTRESSE'
      : bt.seco >= bt.ideal
        ? 'SECO_FAVORAVEL'
        : 'EQUILIBRIO_OPERACIONAL';

  const pPersistSat = clamp01(0.45 + riscoChuva * 0.35 - Rt.residuosRres * 0.15);
  const sat7d = Math.round(
    Math.max(5, Math.min(95, bt.saturado * pPersistSat + bt.ideal * clamp01(riscoChuva * 0.45)))
  );

  const pesos = { alpha: 0.35, beta: 0.15, delta: 0.15, lambda: 0.18, mu: 0.32 };
  const limVento = regiao?.limites?.ventoDerivaKmh || 10;
  const limChuva = regiao?.limites?.chuvaRedMm || 40;

  const candidatas = [
    {
      acao: 'Pulverizar',
      pi: 0.78,
      dSOC: 0.0,
      dAWC: 0.0,
      erosao: clamp01((bt.saturado / 100) * 0.65 * (1 - Rt.residuosRres * 0.4)),
      risk: clamp01((ventoKmh / limVento) * 0.55 + (chuvaMm / limChuva) * 0.45),
    },
    {
      acao: 'Plantar',
      pi: 0.85,
      dSOC: 0.18,
      dAWC: 0.12,
      erosao: clamp01((chuvaMm / limChuva) * 0.55 * (1 - Rt.residuosRres * 0.45)),
      risk: clamp01((bt.saturado / 100) * 0.75 + (chuvaMm / limChuva) * 0.35),
    },
    {
      acao: 'Adubar',
      pi: 0.74 - Rt.nitrogenioRN * 0.12,
      dSOC: 0.08,
      dAWC: 0.04,
      erosao: clamp01((chuvaMm / limChuva) * 0.6),
      risk: clamp01((chuvaMm / limChuva) * 0.7 + (bt.saturado / 100) * 0.4),
    },
    {
      acao: 'Colher',
      pi: 0.90,
      dSOC: 0.05,
      dAWC: 0.02,
      erosao: clamp01((bt.saturado / 100) * 0.7),
      risk: clamp01((bt.saturado / 100) * 0.8 + (chuvaMm / limChuva) * 0.4),
    },
    {
      acao: 'Aguardar / Manejo Conservacionista',
      pi: 0.42,
      dSOC: 0.35,
      dAWC: 0.28,
      erosao: 0.05,
      risk: 0.10,
    },
  ];

  const rankingAcoes = candidatas
    .map((c) => {
      const recompensa =
        pesos.alpha * c.pi +
        pesos.beta * c.dSOC +
        pesos.delta * c.dAWC -
        pesos.lambda * c.erosao -
        pesos.mu * c.risk;
      return {
        acao: c.acao,
        recompensa: Number((recompensa * 100).toFixed(1)),
        riscoPct: Math.round(c.risk * 100),
        erosaoPct: Math.round(c.erosao * 100),
      };
    })
    .sort((a, b) => b.recompensa - a.recompensa);

  return {
    estadoBiofisico: Xt,
    memoriaAgricola: Rt,
    crencaHmm: {
      regimeDominante,
      probabilidadesPct: bt,
      projecaoSaturacao7dPct: sat7d,
    },
    politicaOtima: {
      acaoOtima: rankingAcoes[0].acao,
      recompensaOtima: rankingAcoes[0].recompensa,
      rankingAcoes: rankingAcoes.slice(0, 3),
    },
  };
}

module.exports = {
  memoriaTalhoes,
  obterChaveTalhao,
  atualizarMemoriaAgricola,
  avaliarOperacaoPlanejada,
  aplicarCenarioClimatico,
  avaliarModeloBiofisicoProbabilistico,
};
