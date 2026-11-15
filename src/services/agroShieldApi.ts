import type { Coordinate, Crop } from "@/lib/field";

export type Risk = "red" | "yellow" | "green";
export type ClimateScenario = "current" | "el-nino-2023-24" | "la-nina-2021-22";
export type PlannedOperation = "Pulverizar" | "Plantar" | "Adubar" | "Colher";
export interface FieldRequest {
  polygon: Coordinate[];
  centroid: { lat: number; lng: number };
  areaHectares: number;
  crop: Crop;
  currentRotation: string;
  climateScenario?: ClimateScenario;
  plannedOperation?: PlannedOperation;
  plannedDate?: string;
  simulateRisk?: Risk;
}
export interface OperationPlan {
  operacao: PlannedOperation;
  data: string;
  diasAteAcao: number;
  veredito: "LIBERADA" | "ATENCAO" | "NAO_RECOMENDADA";
  precisaoPrevisaoPct: number;
  horizonteDescricao: string;
  soloAnalisado: string;
  recomendacao: string;
  fonteOficial: string;
}
export interface BiophysModel {
  estadoBiofisico: {
    disponibilidadeHidricaPct: number;
    infiltracaoEstimadaMmH: number;
    carbonoOrganicoIdx: number;
    pressaoFitossanitariaPct: number;
  };
  memoriaAgricola: {
    residuosRres: number;
    nitrogenioRN: number;
    carbonoRC: number;
    raizesRroot: number;
    patogenosRpath: number;
    rotacaoDetectada: string;
  };
  crencaHmm: {
    regimeDominante: "SECO_FAVORAVEL" | "EQUILIBRIO_OPERACIONAL" | "SATURADO_ESTRESSE";
    probabilidadesPct: { seco: number; ideal: number; saturado: number };
    projecaoSaturacao7dPct: number;
  };
  politicaOtima: {
    acaoOtima: string;
    recompensaOtima: number;
    rankingAcoes: Array<{ acao: string; recompensa: number; riscoPct: number; erosaoPct: number }>;
  };
}
export interface SmsAlertLog {
  tipo: string;
  para: string;
  mensagem: string;
  caracteres: number;
  timestamp: string;
}
export interface Sms2GResponse {
  tipo: string;
  de: string;
  pergunta_agricultor: string;
  regiao: string;
  fonte_manual: string;
  risco_fisico: Risk;
  resposta_sms: string;
  caracteres: number;
  enviado_sms_real?: boolean;
  twiml: string;
  timestamp: string;
}
export interface MarkovTrend {
  estadoAtual: "SECO" | "MODERADO" | "CRITICO";
  diasAnalisados: number;
  janelaSeca3dPct: number;
  persistenciaRisco7dPct: number;
  resumo: string;
}
export interface Ensemble14d {
  totalMembros: number;
  chuvaMedianaSemana2Mm: number;
  consensoChuvaSemana2Pct: number;
  consensoSecaSemana2Pct: number;
  tendenciaSemana2: "CHUVOSA" | "SECA";
  confiancaConsensoPct: number;
  balancoHidrico7dMm: number | null;
  resumo: string;
}
export interface FieldAnalysis {
  risk: Risk;
  historicalRain: number;
  predictedRain: number;
  soilMoisture: number;
  rootZoneMoisture?: number;
  soilTempC?: number | null;
  soilVolumetricM3?: number | null;
  tempArC?: number | null;
  umidadeRelativaPct?: number | null;
  deltaT?: number | null;
  deltaTStatus?: string | null;
  pressureHpa?: number | null;
  pressureDropHpa?: number | null;
  pressureTrend?: "QUEDA_BRUSCA" | "INSTAVEL" | "ESTAVEL" | string | null;
  rainHeatmapGrid?: Array<{
    label: string;
    lat: number;
    lng: number;
    rain24hMm: number;
    pressureHpa: number | null;
  }>;
  ndviPercent?: number;
  ndviSource?: string;
  canopyTempC?: number;
  canopyTempSource?: string;
  groundCoverPercent?: number;
  groundCoverSource?: string;
  riskScore?: number;
  windSpeedKmh?: number;
  windLimitKmh?: number;
  rainLimitMm?: number;
  regionCode?: string;
  regionName?: string;
  soilType?: string;
  manualSource?: string;
  dataSources?: string;
  markov?: MarkovTrend | null;
  ensemble14d?: Ensemble14d | null;
  operationPlan?: OperationPlan | null;
  biophysModel?: BiophysModel | null;
  elevation?: {
    altitudeMediaM: number;
    desnivelM: number;
    declividadePct: number;
    riscoTopografico: string;
  } | null;
  hourlyWindow?: {
    melhorJanela: string;
    horasSeguras: number;
    resumo: string;
  } | null;
  smsAlert?: SmsAlertLog | null;
  guidance: string;
  actions: string[];
  technicalReason: string;
  source: "demo" | "api";
  fallbackReason?: string;
}
export function makeDemoAnalysis(risk: Risk = "red"): FieldAnalysis {
  const common = {
    risk,
    historicalRain: 32,
    soilMoisture: risk === "red" ? 89 : risk === "yellow" ? 72 : 56,
    source: "demo" as const,
  };
  if (risk === "red")
    return {
      ...common,
      predictedRain: 112,
      guidance:
        "Tempestade severa prevista para as próximas 24h. Suspenda a pulverização, evite adubação de cobertura e retire os tratores das áreas de baixada.",
      actions: [
        "Suspender a pulverização programada para amanhã",
        "Adiar a adubação de cobertura para evitar perda de insumos",
        "Retirar máquinas e equipamentos das áreas de baixada",
      ],
      technicalReason:
        "Neste cenário simulado, a chuva de 112 mm supera em 250% a referência histórica de 32 mm. A umidade estimada do solo de 89% indica pouca capacidade de absorção. Uma integração real poderá cruzar precipitação GPM e variáveis meteorológicas POWER. Os satélites não medem a drenagem local e o cenário de El Niño não foi validado para esta área.",
    };
  if (risk === "yellow")
    return {
      ...common,
      predictedRain: 58,
      guidance:
        "Chuva acima do normal nas próximas 24h. Reavalie a janela de pulverização e acompanhe as áreas com drenagem mais lenta.",
      actions: [
        "Reavaliar a janela de pulverização",
        "Inspecionar drenagem e pontos de acúmulo de água",
        "Conferir a previsão local antes de entrar com máquinas",
      ],
      technicalReason:
        "O cenário simula 58 mm de chuva frente à referência de 32 mm e umidade do solo de 72%. Há risco de encharcamento pontual. Os valores não são observações NASA; drenagem, relevo e previsão local precisam ser confirmados.",
    };
  return {
    ...common,
    predictedRain: 28,
    guidance:
      "Condições favoráveis no cenário simulado. Mantenha o planejamento de campo e confirme vento e chuva na previsão local antes da pulverização.",
    actions: [
      "Confirmar vento e condições locais antes de pulverizar",
      "Manter a cobertura do solo e a drenagem em dia",
      "Acompanhar a previsão antes da próxima operação",
    ],
    technicalReason:
      "O cenário simula 28 mm de chuva, abaixo da referência histórica de 32 mm, e umidade do solo de 56%. Não indica alerta imediato, mas não substitui uma avaliação agronômica nem a previsão local.",
  };
}
function isAnalysis(value: unknown): value is FieldAnalysis {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const optionalPercentages = ["ndviPercent", "groundCoverPercent"];
  const validOptionalMeasurements =
    optionalPercentages.every(
      (key) =>
        v[key] === undefined ||
        (typeof v[key] === "number" &&
          Number.isFinite(v[key]) &&
          Number(v[key]) >= 0 &&
          Number(v[key]) <= 100),
    ) &&
    (v["canopyTempC"] === undefined ||
      (typeof v["canopyTempC"] === "number" &&
        Number.isFinite(v["canopyTempC"]) &&
        Number(v["canopyTempC"]) >= -50 &&
        Number(v["canopyTempC"]) <= 80)) &&
    ["ndviSource", "canopyTempSource", "groundCoverSource"].every(
      (key) => v[key] === undefined || (typeof v[key] === "string" && v[key].length <= 120),
    );
  return (
    ["red", "yellow", "green"].includes(String(v["risk"])) &&
    validOptionalMeasurements &&
    ["historicalRain", "predictedRain", "soilMoisture"].every(
      (k) => typeof v[k] === "number" && Number.isFinite(v[k]) && Number(v[k]) >= 0,
    ) &&
    typeof v["guidance"] === "string" &&
    typeof v["technicalReason"] === "string" &&
    Array.isArray(v["actions"]) &&
    v["actions"].length === 3 &&
    v["actions"].every((a) => typeof a === "string")
  );
}
export async function analyzeField(
  data: FieldRequest,
  backendUrl?: string,
): Promise<FieldAnalysis> {
  if (!backendUrl?.trim()) return makeDemoAnalysis();
  try {
    const url = new URL(backendUrl);
    if (!["https:", "http:"].includes(url.protocol)) throw new Error("Endereço inválido");
    const response = await fetch(`${backendUrl.replace(/\/$/, "")}/api/analyze-field`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(35000),
    });
    if (!response.ok) throw new Error("Falha na análise");
    const result: unknown = await response.json();
    if (!isAnalysis(result)) throw new Error("Resposta incompatível");
    return { ...result, source: "api" };
  } catch {
    return {
      ...makeDemoAnalysis(data.simulateRisk ?? "red"),
      fallbackReason:
        "Não foi possível acessar a API. Exibindo um cenário demonstrativo, sem dados ao vivo.",
    };
  }
}

function escaparXmlSimulado(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function makeDemoSms2GResponse(
  mensagem: string,
  field: FieldRequest,
  analysis?: Partial<FieldAnalysis> | null,
): Sms2GResponse {
  const risco: Risk = analysis?.risk ?? field.simulateRisk ?? "red";
  const chuva = analysis?.predictedRain ?? (risco === "red" ? 68 : risco === "yellow" ? 32 : 12);
  const vento =
    analysis?.windSpeedKmh ?? (risco === "red" ? 14.4 : risco === "yellow" ? 11.2 : 6.5);
  const umidade = analysis?.soilMoisture ?? (risco === "red" ? 89 : risco === "yellow" ? 72 : 54);
  const manual = analysis?.manualSource || "EMBRAPA / IDR-Parana";
  const regiao = analysis?.regionCode || "PR";

  const operacaoTexto = /\bplant/i.test(mensagem)
    ? "plantar"
    : /\badub/i.test(mensagem)
      ? "adubar"
      : /\bcolh/i.test(mensagem)
        ? "colher"
        : "pulverizar";

  const rawBody =
    risco === "red"
      ? `AGROSHIELD: NAO ${operacaoTexto} ${field.crop}. Chuva ${chuva}mm, vento ${vento}km/h e solo ${umidade}% (${manual}). Risco severo.`
      : risco === "yellow"
        ? `AGROSHIELD: ATENCAO para ${operacaoTexto} ${field.crop}. Chuva ${chuva}mm, vento ${vento}km/h e solo ${umidade}% (${manual}).`
        : `AGROSHIELD: SIM, janela liberada p/ ${operacaoTexto} ${field.crop}. Chuva ${chuva}mm, vento ${vento}km/h (${manual}).`;

  const respostaSms = rawBody.length > 150 ? `${rawBody.slice(0, 147).trimEnd()}...` : rawBody;

  return {
    tipo: "INBOUND_SIMULADO_FRONT_2G",
    de: "+5544999874707",
    pergunta_agricultor: mensagem.trim() || "STATUS",
    regiao,
    fonte_manual: manual,
    risco_fisico: risco,
    resposta_sms: respostaSms,
    caracteres: respostaSms.length,
    twiml: `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaparXmlSimulado(respostaSms)}</Message></Response>`,
    timestamp: new Date().toISOString(),
  };
}

export async function sendSms2GQuery(
  mensagem: string,
  field: FieldRequest,
  backendUrl = "http://localhost:3000",
  analysis?: Partial<FieldAnalysis> | null,
  telefone?: string,
): Promise<Sms2GResponse> {
  const base = backendUrl.trim().replace(/\/$/, "");
  if (!base) {
    return makeDemoSms2GResponse(mensagem, field, analysis);
  }
  try {
    const cleanPhone = telefone?.trim();
    const response = await fetch(`${base}/api/sms-responder?format=json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(cleanPhone ? { From: cleanPhone, telefone: cleanPhone } : {}),
        Body: mensagem,
        crop: field.crop,
        centroid: field.centroid,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error("Falha ao consultar SMS 2G no back-end");
    return (await response.json()) as Sms2GResponse;
  } catch {
    return makeDemoSms2GResponse(mensagem, field, analysis);
  }
}
