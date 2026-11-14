/**
 * ============================================================================
 * 🕵️‍♂️ BATERIA DE AUDITORIA QA & CAÇA-BUGS (AGROSHIELD E2E)
 * ============================================================================
 * Testa 10 cenários extremos, malformados e de fronteira geográfica para
 * encontrar qualquer falha oculta antes da apresentação na banca!
 */

const {
  auditarEFormatarParaFrontEnd,
  normalizarFieldRequest,
  obterDiretrizRegional,
  calcularPisoFisicoRegional,
  auditarSms2GContraFisica,
  escaparXmlTwiml,
  calcularTendenciaMarkov,
  avaliarCertezaAlertaSms,
} = require('./server');

function isAnalysisFrontEndValidator(v) {
  if (!v || typeof v !== 'object') return false;
  return (
    ['red', 'yellow', 'green'].includes(String(v.risk)) &&
    ['historicalRain', 'predictedRain', 'soilMoisture'].every(
      (k) => typeof v[k] === 'number' && Number.isFinite(v[k]) && v[k] >= 0
    ) &&
    typeof v.guidance === 'string' &&
    typeof v.technicalReason === 'string' &&
    Array.isArray(v.actions) &&
    v.actions.length === 3 &&
    v.actions.every((a) => typeof a === 'string')
  );
}

const bugsEncontrados = [];
const testesPassados = [];

function registrarResultado(nomeTeste, passou, detalhe) {
  if (passou) {
    testesPassados.push({ nomeTeste, detalhe });
    console.log(`✅ [PASSOU] ${nomeTeste}: ${detalhe}`);
  } else {
    bugsEncontrados.push({ nomeTeste, detalhe });
    console.log(`❌ [BUG DETECTADO] ${nomeTeste}: ${detalhe}`);
  }
}

// ----------------------------------------------------------------------------
// TESTE 1: Centroide com { lat: null, lng: null } ou strings vazias ""
// ----------------------------------------------------------------------------
const reqNullCentroid = normalizarFieldRequest({
  polygon: [],
  centroid: { lat: null, lng: '' },
  areaHectares: null,
  crop: 'Soja',
});
registrarResultado(
  'Teste 1: Coordenada nula { lat: null, lng: "" } não deve virar (0, 0) no Oceano Atlântico',
  reqNullCentroid.centroid.lat !== 0 && reqNullCentroid.centroid.lng !== 0,
  `Centroide resultante: (${reqNullCentroid.centroid.lat}, ${reqNullCentroid.centroid.lng}) — esperado Campo Mourão (-24.045, -52.383)`
);

// ----------------------------------------------------------------------------
// TESTE 2: Sobreposição de Bounding Box na América do Sul (Uruguai / Santa Fe - Argentina)
// ----------------------------------------------------------------------------
const regiaoRosarioArg = obterDiretrizRegional(-32.94, -60.63, 'Soja'); // Rosário, Argentina
const regiaoUruguai = obterDiretrizRegional(-32.52, -55.76, 'Soja'); // Centro do Uruguai
registrarResultado(
  'Teste 2: Fazenda nos Pampas (Rosário/Argentina e Uruguai) deve usar INTA/INIA e não EMBRAPA Brasil',
  regiaoRosarioArg.uf === 'AR_PAMPAS' && regiaoUruguai.uf === 'AR_PAMPAS',
  `Rosário/AR classificado como "${regiaoRosarioArg.uf}" (${regiaoRosarioArg.fonte}) | Uruguai classificado como "${regiaoUruguai.uf}" (${regiaoUruguai.fonte})`
);

// ----------------------------------------------------------------------------
// TESTE 3: Sobreposição PR vs SP (Oeste/Sudoeste de São Paulo: Ourinhos/Presidente Prudente)
// ----------------------------------------------------------------------------
const regiaoRibeiraoPreto = obterDiretrizRegional(-21.17, -47.81, 'Soja'); // Ribeirão Preto - SP
registrarResultado(
  'Teste 3: Sudeste (Ribeirão Preto - SP) não deve cair como Cerrado MT/GO genérico se houver Sudeste',
  regiaoRibeiraoPreto.uf === 'SUDESTE' || regiaoRibeiraoPreto.uf === 'BR',
  `Ribeirão Preto/SP classificado como "${regiaoRibeiraoPreto.uf}" (${regiaoRibeiraoPreto.nome})`
);

// ----------------------------------------------------------------------------
// TESTE 4: React Duplicate Key em AnalysisDashboard.tsx (actions com textos repetidos)
// ----------------------------------------------------------------------------
const reqPadrao = normalizarFieldRequest({});
const nasaPadrao = {
  historicalRain: 50,
  predictedRain: 60,
  soilMoisture: 85,
  windSpeed2m: 4.0,
  minPhysicalRisk: 'red',
};
const iaComActionsRepetidas = {
  risk: 'red',
  guidance: 'Suspenda as operações imediatamente devido ao excesso de chuva e vento.',
  actions: ['Ação idêntica repetida', 'Ação idêntica repetida', 'Ação idêntica repetida'],
  technicalReason: 'EMBRAPA/ZARC: Chuva acima do limite.',
};
const resActions = auditarEFormatarParaFrontEnd(iaComActionsRepetidas, reqPadrao, nasaPadrao);
const actionsUnicas = new Set(resActions.actions).size === 3;
registrarResultado(
  'Teste 4: Prevenção de Duplicate Key no React (<label key={action}> no AnalysisDashboard.tsx)',
  actionsUnicas,
  `Actions retornadas: ${JSON.stringify(resActions.actions)}`
);

// ----------------------------------------------------------------------------
// TESTE 5: IA tentando alucinar "green" num dia de Tempestade Vermelha (45mm + 12 km/h no PR)
// ----------------------------------------------------------------------------
const resVeto = auditarEFormatarParaFrontEnd(
  {
    risk: 'green',
    guidance: 'Condições favoráveis, operações liberadas para pulverizar hoje!',
    actions: ['Pode pulverizar tranquilo', 'Entrar com trator pesado', 'Aplicar adubo'],
    technicalReason: 'Clima ótimo segundo análise.',
  },
  reqPadrao,
  nasaPadrao
);
const vetoFuncionou =
  resVeto.risk === 'red' &&
  !resVeto.guidance.toLowerCase().includes('condições favoráveis');
registrarResultado(
  'Teste 5: Veto da Trava Pós-IA quando o LLM alucina "green" em dia de tempestade',
  vetoFuncionou && isAnalysisFrontEndValidator(resVeto),
  `Risk após veto: "${resVeto.risk}" | Guidance corrigida: "${resVeto.guidance.slice(0, 65)}..."`
);

// ----------------------------------------------------------------------------
// TESTE 6: Polígono com coordenadas fora de alcance (Lat > 90 ou Lng > 180)
// ----------------------------------------------------------------------------
const reqForaDoGlobo = normalizarFieldRequest({
  polygon: [
    [999, 999],
    [999, 998],
    [998, 998],
  ],
  centroid: { lat: 999, lng: -999 },
  areaHectares: -50,
  crop: 'CulturaInexistente',
});
const coordsDentroDoGlobo =
  Math.abs(reqForaDoGlobo.centroid.lat) <= 90 &&
  Math.abs(reqForaDoGlobo.centroid.lng) <= 180;
registrarResultado(
  'Teste 6: Rejeição de coordenadas impossíveis (Lat 999, Lng -999) que quebram a API da NASA',
  coordsDentroDoGlobo,
  `Centroide resultante: (${reqForaDoGlobo.centroid.lat}, ${reqForaDoGlobo.centroid.lng})`
);

// ----------------------------------------------------------------------------
// TESTE 7: Veto das Actions quando a IA alucina "Pode pulverizar" dentro do checklist em dia de Risco Vermelho
// ----------------------------------------------------------------------------
const actionsNaoMandamPulverizarNoPerigo = !resVeto.actions.some((a) =>
  /pode pulverizar tranquilo|entrar com trator pesado/i.test(a)
);
registrarResultado(
  'Teste 7: Veto de Actions perigosas no checklist quando a IA sofre intervenção de risco',
  actionsNaoMandamPulverizarNoPerigo,
  `Actions entregues ao produtor no risco vermelho: ${JSON.stringify(resVeto.actions)}`
);

// ----------------------------------------------------------------------------
// TESTE 8: SMS 2G Offline - Veto Pós-IA quando o LLM diz "SIM, pode pulverizar" em dia de Vento/Tempestade
// ----------------------------------------------------------------------------
const smsAlucinado = auditarSms2GContraFisica(
  'AGROSHIELD: SIM, pode pulverizar hoje tranquilo na soja!',
  reqPadrao,
  nasaPadrao
);
registrarResultado(
  'Teste 8: SMS 2G Offline - Trava Pós-IA veta falso positivo ("SIM") quando o risco físico é vermelho',
  smsAlucinado.includes('NAO') && !/\bsim\b/i.test(smsAlucinado),
  `SMS corrigido pela trava: "${smsAlucinado}" (${smsAlucinado.length} chars)`
);

// ----------------------------------------------------------------------------
// TESTE 9: SMS 2G Offline - Limite estrito de <= 150 caracteres para caber em 1 frame GSM 2G
// ----------------------------------------------------------------------------
const smsGigante = auditarSms2GContraFisica(
  'AGROSHIELD: NAO pulverize hoje porque a chuva acumulada da NASA POWER superou todos os limites históricos da EMBRAPA Soja Paraná e o risco de deriva e compactação de latossolo vermelho é altíssimo em Campo Mourão!',
  reqPadrao,
  nasaPadrao
);
registrarResultado(
  'Teste 9: SMS 2G Offline - Truncamento seguro em <= 150 caracteres (1 frame GSM 2G)',
  smsGigante.length <= 150 && smsGigante.startsWith('AGROSHIELD:'),
  `Tamanho final: ${smsGigante.length} caracteres <= 150 | Texto: "${smsGigante}"`
);

// ----------------------------------------------------------------------------
// TESTE 10: SMS 2G Offline - Escapamento XML TwiML contra quebra por "< 10 km/h" ou "&"
// ----------------------------------------------------------------------------
const xmlEscapado = escaparXmlTwiml('AGROSHIELD: Vento < 10 km/h & umidade > 80%');
registrarResultado(
  'Teste 10: SMS 2G Offline - Proteção TwiML XML contra caracteres "<", ">" e "&" (Erro Twilio 12100)',
  !xmlEscapado.includes('<') && !xmlEscapado.includes('>') && xmlEscapado.includes('&lt;') && xmlEscapado.includes('&amp;'),
  `XML escapado: "${xmlEscapado}"`
);

// ----------------------------------------------------------------------------
// TESTE 11: Metadados de limites regionais numéricos válidos (sem NaN / undefined)
// ----------------------------------------------------------------------------
const limitesValidos =
  Number.isFinite(resVeto.rainLimitMm) &&
  resVeto.rainLimitMm > 0 &&
  Number.isFinite(resVeto.windLimitKmh) &&
  resVeto.windLimitKmh > 0 &&
  Number.isFinite(resVeto.windSpeedKmh) &&
  resVeto.windSpeedKmh >= 0;
registrarResultado(
  'Teste 11: Limites regionais e velocidade do vento em km/h são números finitos válidos',
  limitesValidos,
  `rainLimitMm=${resVeto.rainLimitMm}, windLimitKmh=${resVeto.windLimitKmh}, windSpeedKmh=${resVeto.windSpeedKmh}`
);

// ----------------------------------------------------------------------------
// TESTE 12: Auditor Numérico Anti-Alucinação no Dashboard (LLM inventando "250 mm" ou "95 km/h")
// ----------------------------------------------------------------------------
const resAlucinacaoNumerica = auditarEFormatarParaFrontEnd(
  {
    risk: 'red',
    guidance: 'Alerta crítico: chuva inventada de 250 mm e vento falso de 95 km/h na lavoura.',
    actions: [
      'Cancelar operação devido à chuva falsa de 250 mm',
      'Retirar máquinas do talhão',
      'Monitorar drenagem',
    ],
    technicalReason: 'EMBRAPA: Umidade inventada de 12% e chuva de 250 mm.',
  },
  reqPadrao,
  nasaPadrao
);
const bloqueouNumerosInventados =
  !resAlucinacaoNumerica.guidance.includes('250 mm') &&
  !resAlucinacaoNumerica.guidance.includes('95 km/h') &&
  !resAlucinacaoNumerica.technicalReason.includes('250 mm') &&
  !resAlucinacaoNumerica.actions.some((a) => a.includes('250 mm'));
registrarResultado(
  'Teste 12: Auditor Numérico bloqueia números inventados pela IA (250 mm / 95 km/h / 12%) no texto e actions',
  bloqueouNumerosInventados,
  `Guidance auditada com dados reais (60 mm / 14.4 km/h): "${resAlucinacaoNumerica.guidance.slice(0, 75)}..."`
);

// ----------------------------------------------------------------------------
// TESTE 13: Auditor Numérico Anti-Alucinação no SMS 2G Offline
// ----------------------------------------------------------------------------
const smsNumeroInventado = auditarSms2GContraFisica(
  'AGROSHIELD: NAO opere. Chuva de 300 mm e vento de 88 km/h detectados agora.',
  reqPadrao,
  nasaPadrao
);
registrarResultado(
  'Teste 13: Auditor Numérico bloqueia números inventados pela IA no SMS 2G Offline',
  !smsNumeroInventado.includes('300') && !smsNumeroInventado.includes('88'),
  `SMS corrigido com números reais: "${smsNumeroInventado}"`
);

// ----------------------------------------------------------------------------
// TESTE 14: Cadeia de Markov (tendência 3d/7d sobre série diária NASA POWER)
// ----------------------------------------------------------------------------
const serieSimulada = { PRECTOTCORR: {}, GWETTOP: {}, WS2M: {} };
for (let i = 1; i <= 20; i++) {
  const dia = `202610${String(i).padStart(2, '0')}`;
  serieSimulada.PRECTOTCORR[dia] = i % 5 === 0 ? 35 : 0;
  serieSimulada.GWETTOP[dia] = i % 5 === 0 ? 0.85 : 0.45;
  serieSimulada.WS2M[dia] = 2.0;
}
const markovRes = calcularTendenciaMarkov(serieSimulada);
registrarResultado(
  'Teste 14: Cadeia de Markov calcula probabilidades válidas (0..100%) sobre série da NASA',
  markovRes.diasAnalisados === 20 &&
    markovRes.janelaSeca3dPct >= 0 &&
    markovRes.janelaSeca3dPct <= 100 &&
    markovRes.persistenciaRisco7dPct >= 0 &&
    markovRes.persistenciaRisco7dPct <= 100,
  markovRes.resumo
);

// ----------------------------------------------------------------------------
// TESTE 15: Portão de Certeza SMS 2G bloqueia disparo se só a IA chutou "red" sem confirmação física/INMET
// ----------------------------------------------------------------------------
const gateBloqueado = avaliarCertezaAlertaSms(
  { predictedRain: 18, soilMoisture: 58, windSpeed2m: 3.1, ventoKmh: 11.2, minPhysicalRisk: 'yellow', nasaLive: true },
  obterDiretrizRegional(-24.045, -52.383, 'Soja'),
  null
);
registrarResultado(
  'Teste 15: Portão de Certeza bloqueia SMS se não houver confirmação física severa nem alerta INMET',
  gateBloqueado.autorizado === false,
  gateBloqueado.motivo
);

// ----------------------------------------------------------------------------
// TESTE 16: Portão de Certeza autoriza SMS quando há confirmação física severa OU INMET Perigo + satélite
// ----------------------------------------------------------------------------
const gateAutorizadoInmet = avaliarCertezaAlertaSms(
  { predictedRain: 28, soilMoisture: 68, windSpeed2m: 3.2, ventoKmh: 11.5, minPhysicalRisk: 'yellow', nasaLive: true },
  obterDiretrizRegional(-24.045, -52.383, 'Soja'),
  { severidade: 'Grande Perigo', evento: 'Tempestade Severa', fonte: 'INMET / Defesa Civil' }
);
registrarResultado(
  'Teste 16: Portão de Certeza autoriza SMS com consenso duplo (INMET Grande Perigo + satélite)',
  gateAutorizadoInmet.autorizado === true,
  gateAutorizadoInmet.motivo
);

console.log('\n============================================================================');
console.log(`📊 RESUMO DA AUDITORIA: ${testesPassados.length} passaram | ${bugsEncontrados.length} bugs encontrados`);
console.log('============================================================================');
if (bugsEncontrados.length > 0) process.exit(1);
