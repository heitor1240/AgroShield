import type { Coordinate, Crop } from '@/lib/field';

export type Risk = 'red' | 'yellow' | 'green';
export interface FieldRequest {
  polygon: Coordinate[];
  centroid: { lat: number; lng: number };
  areaHectares: number;
  crop: Crop;
  currentRotation: string;
  simulateRisk?: Risk;
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
  twiml: string;
  timestamp: string;
}
export interface FieldAnalysis {
  risk: Risk;
  historicalRain: number;
  predictedRain: number;
  soilMoisture: number;
  windSpeedKmh?: number;
  windLimitKmh?: number;
  rainLimitMm?: number;
  regionCode?: string;
  regionName?: string;
  soilType?: string;
  manualSource?: string;
  smsAlert?: SmsAlertLog | null;
  guidance: string;
  actions: string[];
  technicalReason: string;
  source: 'demo' | 'api';
  fallbackReason?: string;
}
export function makeDemoAnalysis(risk: Risk = 'red'): FieldAnalysis {
  const common = { risk, historicalRain: 32, soilMoisture: risk === 'red' ? 89 : risk === 'yellow' ? 72 : 56, source: 'demo' as const };
  if (risk === 'red') return { ...common, predictedRain: 112,
    guidance: 'Tempestade severa prevista para as próximas 24h. Suspenda a pulverização, evite adubação de cobertura e retire os tratores das áreas de baixada.',
    actions: ['Suspender a pulverização programada para amanhã', 'Adiar a adubação de cobertura para evitar perda de insumos', 'Retirar máquinas e equipamentos das áreas de baixada'],
    technicalReason: 'Neste cenário simulado, a chuva de 112 mm supera em 250% a referência histórica de 32 mm. A umidade estimada do solo de 89% indica pouca capacidade de absorção. Uma integração real poderá cruzar precipitação GPM e variáveis meteorológicas POWER. Os satélites não medem a drenagem local e o cenário de El Niño não foi validado para esta área.' };
  if (risk === 'yellow') return { ...common, predictedRain: 58,
    guidance: 'Chuva acima do normal nas próximas 24h. Reavalie a janela de pulverização e acompanhe as áreas com drenagem mais lenta.',
    actions: ['Reavaliar a janela de pulverização', 'Inspecionar drenagem e pontos de acúmulo de água', 'Conferir a previsão local antes de entrar com máquinas'],
    technicalReason: 'O cenário simula 58 mm de chuva frente à referência de 32 mm e umidade do solo de 72%. Há risco de encharcamento pontual. Os valores não são observações NASA; drenagem, relevo e previsão local precisam ser confirmados.' };
  return { ...common, predictedRain: 28,
    guidance: 'Condições favoráveis no cenário simulado. Mantenha o planejamento de campo e confirme vento e chuva na previsão local antes da pulverização.',
    actions: ['Confirmar vento e condições locais antes de pulverizar', 'Manter a cobertura do solo e a drenagem em dia', 'Acompanhar a previsão antes da próxima operação'],
    technicalReason: 'O cenário simula 28 mm de chuva, abaixo da referência histórica de 32 mm, e umidade do solo de 56%. Não indica alerta imediato, mas não substitui uma avaliação agronômica nem a previsão local.' };
}
function isAnalysis(value: unknown): value is FieldAnalysis {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return ['red', 'yellow', 'green'].includes(String(v['risk'])) &&
    ['historicalRain', 'predictedRain', 'soilMoisture'].every(k => typeof v[k] === 'number' && Number.isFinite(v[k]) && Number(v[k]) >= 0) &&
    typeof v['guidance'] === 'string' && typeof v['technicalReason'] === 'string' &&
    Array.isArray(v['actions']) && v['actions'].length === 3 && v['actions'].every(a => typeof a === 'string');
}
export async function analyzeField(data: FieldRequest, backendUrl?: string): Promise<FieldAnalysis> {
  if (!backendUrl?.trim()) return makeDemoAnalysis();
  try {
    const url = new URL(backendUrl);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Endereço inválido');
    const response = await fetch(`${backendUrl.replace(/\/$/, '')}/api/analyze-field`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data), signal: AbortSignal.timeout(35000),
    });
    if (!response.ok) throw new Error('Falha na análise');
    const result: unknown = await response.json();
    if (!isAnalysis(result)) throw new Error('Resposta incompatível');
    return { ...result, source: 'api' };
  } catch {
    return { ...makeDemoAnalysis(data.simulateRisk ?? 'red'), fallbackReason: 'Não foi possível acessar a API. Exibindo um cenário demonstrativo, sem dados ao vivo.' };
  }
}

export async function sendSms2GQuery(
  mensagem: string,
  field: FieldRequest,
  backendUrl = 'http://localhost:3000'
): Promise<Sms2GResponse> {
  const base = backendUrl.trim().replace(/\/$/, '') || 'http://localhost:3000';
  const response = await fetch(`${base}/api/sms-responder?format=json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      From: '+5544999999999',
      Body: mensagem,
      crop: field.crop,
      centroid: field.centroid,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('Falha ao consultar SMS 2G no back-end');
  return (await response.json()) as Sms2GResponse;
}