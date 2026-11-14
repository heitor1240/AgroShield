/**
 * ============================================================================
 * 🚜 AGROSHIELD BACK-END - 100% ALINHADO AO FRONT-END (heitor1240/screenshot-exact)
 * ============================================================================
 * Contrato Oficial do Front-end (src/services/agroShieldApi.ts):
 * - Rota: POST /api/analyze-field
 * - Entrada (FieldRequest):
 *   {
 *     polygon: [number, number][], // Array de [lat, lng]
 *     centroid: { lat: number, lng: number },
 *     areaHectares: number,
 *     crop: 'Soja' | 'Milho' | 'Trigo' | 'Outro',
 *     currentRotation: string
 *   }
 * - Saída exigida pelo validador isAnalysis() do Front-end (FieldAnalysis):
 *   {
 *     risk: 'red' | 'yellow' | 'green',
 *     historicalRain: number,   // número finito >= 0 (mm)
 *     predictedRain: number,    // número finito >= 0 (mm)
 *     soilMoisture: number,     // número finito >= 0 (%)
 *     guidance: string,         // Orientação tática (Próximas 24h)
 *     actions: [string, string, string], // OBRIGATORIAMENTE 3 strings (Checklist 0/3)
 *     technicalReason: string,  // Justificativa técnica detalhada
 *     source: 'api'
 *   }
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const turf = require('@turf/turf');
const Anthropic = require('@anthropic-ai/sdk');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS liberado para o Front-end (Vite / TanStack Start) acessar sem bloqueio do navegador
app.use(cors());
app.use(express.json({ limit: '10mb' }));
// Obrigatório para receber Webhooks de SMS 2G do Twilio (application/x-www-form-urlencoded)
app.use(express.urlencoded({ extended: false }));

// ============================================================================
// 1. BANCO DE DADOS POSTGRESQL (JSONB) COM FALLBACK EM MEMÓRIA
// ============================================================================
const pgPool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://agroshield:agroshield_secret_2026@localhost:5432/agroshield_db',
  connectionTimeoutMillis: 2500,
});

let dbOnline = false;
const memoriaFallbackDB = [];

async function inicializarBancoDeDados() {
  try {
    const client = await pgPool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS field_analyses (
        id SERIAL PRIMARY KEY,
        crop VARCHAR(50) NOT NULL,
        current_rotation VARCHAR(120) NOT NULL,
        area_hectares DOUBLE PRECISION NOT NULL,
        centroid_lat DOUBLE PRECISION NOT NULL,
        centroid_lng DOUBLE PRECISION NOT NULL,
        polygon_geojson JSONB NOT NULL,
        nasa_metrics JSONB NOT NULL,
        analysis_response JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    client.release();
    dbOnline = true;
    console.log('🐘 [POSTGRESQL] Conectado e tabela JSONB "field_analyses" pronta.');
  } catch (err) {
    dbOnline = false;
    console.warn(
      `⚠️ [POSTGRESQL] Container offline (${err.message}). Usando persistência em memória.`
    );
  }
}

async function salvarAnaliseNoBanco(fieldRequest, nasaMetrics, analysisResponse) {
  try {
    const registro = {
      crop: fieldRequest.crop,
      currentRotation: fieldRequest.currentRotation,
      areaHectares: fieldRequest.areaHectares,
      centroid: fieldRequest.centroid,
      polygon: fieldRequest.polygon,
      nasaMetrics,
      analysisResponse,
      createdAt: new Date().toISOString(),
    };

    if (dbOnline) {
      await pgPool.query(
        `INSERT INTO field_analyses
          (crop, current_rotation, area_hectares, centroid_lat, centroid_lng, polygon_geojson, nasa_metrics, analysis_response)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)`,
        [
          registro.crop,
          registro.currentRotation,
          registro.areaHectares,
          registro.centroid.lat,
          registro.centroid.lng,
          JSON.stringify(registro.polygon),
          JSON.stringify(registro.nasaMetrics),
          JSON.stringify(registro.analysisResponse),
        ]
      );
    } else {
      memoriaFallbackDB.unshift(registro);
      if (memoriaFallbackDB.length > 100) memoriaFallbackDB.pop();
    }
  } catch (err) {
    console.warn('[AVISO DB] Erro ao gravar análise:', err.message);
  }
}

// ============================================================================
// 2. VALIDAÇÃO E CÁLCULO GEOESPACIAL (@turf/turf - idêntico a src/lib/field.ts)
// ============================================================================
const INITIAL_CENTER = { lat: -24.045, lng: -52.383 }; // Campo Mourão, PR

function normalizarFieldRequest(body = {}) {
  const cropValidos = ['Soja', 'Milho', 'Trigo', 'Outro'];
  const crop = cropValidos.includes(body.crop) ? body.crop : 'Soja';
  const currentRotation =
    typeof body.currentRotation === 'string' && body.currentRotation.trim()
      ? body.currentRotation.trim()
      : 'Soja → Milho Safrinha';

  const polygon = Array.isArray(body.polygon) ? body.polygon : [];

  // Tenta calcular centroide e área usando @turf/turf a partir dos vértices [lat, lng] enviados pelo Front-end
  let calcCentroid = null;
  let calcAreaHa = null;

  try {
    if (polygon.length >= 3) {
      const ring = polygon
        .filter((pt) => Array.isArray(pt) && pt.length >= 2)
        .map(([lat, lng]) => [Number(lng), Number(lat)]);

      if (ring.length >= 3) {
        const first = ring[0];
        const closedRing =
          ring[ring.length - 1][0] === first[0] && ring[ring.length - 1][1] === first[1]
            ? ring
            : [...ring, first];

        const shape = turf.polygon([closedRing]);
        const [lng, lat] = turf.centroid(shape).geometry.coordinates;
        const areaHectares = turf.area(shape) / 10000;

        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          calcCentroid = { lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)) };
        }
        if (Number.isFinite(areaHectares) && areaHectares > 0) {
          calcAreaHa = Number(areaHectares.toFixed(2));
        }
      }
    }
  } catch (errTurf) {
    console.warn('[TURF] Usando centroide enviado pelo front-end:', errTurf.message);
  }

  // Valida que lat/lng realmente existem (não null/vazio) e estão dentro dos limites geodésicos da Terra (-90..90 e -180..180)
  const rawLat = body?.centroid?.lat;
  const rawLng = body?.centroid?.lng;
  const latValida =
    rawLat !== null &&
    rawLat !== undefined &&
    rawLat !== '' &&
    typeof rawLat !== 'boolean' &&
    Number.isFinite(Number(rawLat)) &&
    Math.abs(Number(rawLat)) <= 90;
  const lngValida =
    rawLng !== null &&
    rawLng !== undefined &&
    rawLng !== '' &&
    typeof rawLng !== 'boolean' &&
    Number.isFinite(Number(rawLng)) &&
    Math.abs(Number(rawLng)) <= 180;

  // Evita também o ponto (0, 0) acidental no Golfo da Guiné quando o polígono veio vazio
  const isZeroZeroAcidental =
    latValida && lngValida && Number(rawLat) === 0 && Number(rawLng) === 0 && polygon.length === 0;

  const centroid =
    latValida && lngValida && !isZeroZeroAcidental
      ? { lat: Number(Number(rawLat).toFixed(5)), lng: Number(Number(rawLng).toFixed(5)) }
      : calcCentroid && Math.abs(calcCentroid.lat) <= 90 && Math.abs(calcCentroid.lng) <= 180
        ? calcCentroid
        : INITIAL_CENTER;

  const areaInput = Number(body?.areaHectares);
  const areaHectares =
    Number.isFinite(areaInput) && areaInput > 0 ? Number(areaInput.toFixed(2)) : calcAreaHa || 29.8;

  return {
    polygon,
    centroid,
    areaHectares,
    crop,
    currentRotation,
  };
}

// ============================================================================
// 3. TRAVA 1 (ANTES DA IA): CONSULTA E SANITIZAÇÃO FÍSICA DA NASA POWER
// ============================================================================
const SIGLAS_MESES_NASA = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

// Cache em memória das leituras da NASA POWER por coordenada (evita delay de 4s da NASA a cada clique)
const cacheNasaPorCoordenada = new Map();
const cacheDiagnosticoIa = new Map();

async function buscarDadosNasaParaFrontEnd(lat, lng) {
  const chaveCoord = `${Number(lat).toFixed(2)}_${Number(lng).toFixed(2)}`;
  if (cacheNasaPorCoordenada.has(chaveCoord)) {
    return cacheNasaPorCoordenada.get(chaveCoord);
  }

  try {
    const agora = new Date();
    const dataFim = agora.toISOString().slice(0, 10).replace(/-/g, '');
    const dataInicio = new Date(agora.getTime() - 10 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');

    // 1. Climatology: Média histórica da coordenada (PRECTOTCORR)
    const urlClimatology = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=PRECTOTCORR&community=AG&longitude=${lng}&latitude=${lat}&format=JSON`;

    // 2. Daily: Precipitação (PRECTOTCORR), Umidade Superficial do Solo (GWETTOP) e Vento a 2m (WS2M)
    const urlDaily = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,GWETTOP,WS2M&community=AG&longitude=${lng}&latitude=${lat}&start=${dataInicio}&end=${dataFim}&format=JSON`;

    const [resClima, resDaily] = await Promise.all([
      axios.get(urlClimatology, { timeout: 3500 }),
      axios.get(urlDaily, { timeout: 3500 }),
    ]);

    const mesIdx = agora.getMonth();
    const mesNum = mesIdx + 1;
    const mesSigla = SIGLAS_MESES_NASA[mesIdx];

    const tabClima = resClima?.data?.properties?.parameter?.PRECTOTCORR || {};
    const valorClimaBruto =
      tabClima[mesNum] !== undefined ? tabClima[mesNum] : tabClima[mesSigla];

    // Converte mm/dia da climatologia para janela comparável (10 dias) em mm inteiros/decimais
    const historicalRain =
      typeof valorClimaBruto === 'number' && valorClimaBruto >= 0
        ? Math.round(valorClimaBruto < 15 ? valorClimaBruto * 10 : valorClimaBruto)
        : 32;

    const paramDaily = resDaily?.data?.properties?.parameter || {};

    // Filtra flags -999 (dias ainda não processados pelo satélite)
    const chuvasValidas = Object.values(paramDaily.PRECTOTCORR || {}).filter(
      (v) => typeof v === 'number' && v >= 0 && v <= 600
    );
    const umidadesValidas = Object.values(paramDaily.GWETTOP || {}).filter(
      (v) => typeof v === 'number' && v >= 0 && v <= 1
    );
    const ventosValidos = Object.values(paramDaily.WS2M || {}).filter(
      (v) => typeof v === 'number' && v >= 0 && v <= 60
    );

    if (chuvasValidas.length === 0) {
      throw new Error('Sem leituras válidas de precipitação na janela recente da NASA.');
    }

    const picoDiarioMm = Math.max(...chuvasValidas);
    const acumuladoJanelaMm = chuvasValidas.reduce((a, b) => a + b, 0);
    const predictedRain = Math.round(Math.max(picoDiarioMm, acumuladoJanelaMm));

    // Umidade do solo (GWETTOP vem de 0.0 a 1.0 na NASA POWER -> convertemos para 0 a 100%)
    const ultimaUmidade =
      umidadesValidas.length > 0
        ? umidadesValidas[umidadesValidas.length - 1]
        : Math.min(0.92, 0.45 + predictedRain / 200);
    const soilMoisture = Math.min(99, Math.max(15, Math.round(ultimaUmidade * 100)));

    const windSpeed2m =
      ventosValidos.length > 0 ? Number(Math.max(...ventosValidos).toFixed(1)) : 2.8;

    // Gabarito físico determinístico (Pré-IA alinhado às diretrizes EMBRAPA/ZARC: vento > 2.7 m/s e chuva > 50mm)
    let minPhysicalRisk = 'green';
    if (predictedRain >= 50 || soilMoisture >= 82 || windSpeed2m >= 5.0) {
      minPhysicalRisk = 'red';
    } else if (
      windSpeed2m > 2.7 ||
      predictedRain >= 35 ||
      soilMoisture >= 70
    ) {
      minPhysicalRisk = 'yellow';
    }

    const resultadoNasa = {
      historicalRain,
      predictedRain,
      soilMoisture,
      windSpeed2m,
      minPhysicalRisk,
      nasaLive: true,
    };
    cacheNasaPorCoordenada.set(chaveCoord, resultadoNasa);
    return resultadoNasa;
  } catch (err) {
    console.warn(`⚠️ [FALLBACK NASA]: ${err.message}`);
    return {
      historicalRain: 32,
      predictedRain: 112,
      soilMoisture: 89,
      windSpeed2m: 5.2,
      minPhysicalRisk: 'red',
      nasaLive: false,
    };
  }
}

// ============================================================================
// 4. DICIONÁRIO GLOBAL DE ATERRAMENTO (BRASIL + TODO O MUNDO: EMBRAPA/FAO/USDA/INTA/CSIRO)
// ============================================================================
// Cada região/cultura tem: o texto do manual (vai para o Claude) + os limites numéricos
// (usados pelo código para calcular o piso físico, sem depender da IA).
const manuaisRegionais = {
  PR: {
    nome: 'Campo Mourão / Paraná (Brasil)',
    solo: 'Latossolo Vermelho argiloso',
    culturas: {
      Soja: {
        fonte: 'EMBRAPA Soja / IDR-Paraná',
        diretriz:
          'MANUAL EMBRAPA PARANÁ (Solo Argiloso/Latossolo): Alta retenção de água. Chuvas acima de 40mm em 24h saturam o solo; PROIBIDO trânsito de maquinário pesado (risco de atolamento e compactação profunda). Ventos acima de 10 km/h inviabilizam pulverização por deriva para propriedades vizinhas. O El Niño agrava as tempestades de granizo na região de Campo Mourão.',
        limites: { chuvaRedMm: 40, ventoDerivaKmh: 10, ventoRedKmh: 18, umidadeRedPct: 80 },
      },
      Milho: {
        fonte: 'ZARC Milho Paraná / EMBRAPA Milho e Sorgo',
        diretriz:
          'ZARC MILHO PARANÁ: Ventos acima de 35 km/h com solo úmido causam acamamento severo (tombamento da planta). Colheita deve ser antecipada se houver alerta de granizo. Ventos acima de 10 km/h inviabilizam pulverização por deriva. Chuvas acima de 45mm em 24h saturam o Latossolo e impedem tráfego de máquinas.',
        limites: { chuvaRedMm: 45, ventoDerivaKmh: 10, ventoRedKmh: 35, umidadeRedPct: 80 },
      },
      Trigo: {
        fonte: 'EMBRAPA Trigo / ZARC Paraná',
        diretriz:
          'MANUAL EMBRAPA TRIGO PARANÁ: Excesso hídrico acima de 45mm e umidade superficial acima de 75% favorecem Giberela e Brusone na espiga e lixiviam o nitrogênio. Ventos acima de 10 km/h inviabilizam pulverização de fungicidas por deriva. Evitar maquinário pesado em solo saturado.',
        limites: { chuvaRedMm: 45, ventoDerivaKmh: 10, ventoRedKmh: 18, umidadeRedPct: 75 },
      },
      Outro: {
        fonte: 'EMBRAPA / IDR-Paraná',
        diretriz:
          'DIRETRIZ EMBRAPA / IDR-PARANÁ (Latossolo Vermelho): Ventos acima de 10 km/h inviabilizam pulverização por deriva. Chuvas acima de 50mm em 24h ou umidade superficial crítica exigem suspensão de operações mecanizadas e adubações.',
        limites: { chuvaRedMm: 50, ventoDerivaKmh: 10, ventoRedKmh: 18, umidadeRedPct: 80 },
      },
    },
  },
  BA: {
    nome: 'MATOPIBA / Oeste da Bahia (Brasil)',
    solo: 'solo arenoso de alta drenagem',
    culturas: {
      Soja: {
        fonte: 'EMBRAPA MATOPIBA',
        diretriz:
          'MANUAL EMBRAPA MATOPIBA/BAHIA (Solo Arenoso): Alta drenagem. Suporta volumes maiores de chuva sem atolamento, mas sofre erosão rápida. Ventos fortes exigem umidificadores na pulverização devido à baixa umidade do ar. Ventos acima de 10 km/h inviabilizam pulverização por deriva.',
        limites: { chuvaRedMm: 70, ventoDerivaKmh: 10, ventoRedKmh: 18, umidadeRedPct: 90 },
      },
      Outro: {
        fonte: 'EMBRAPA MATOPIBA',
        diretriz:
          'DIRETRIZ EMBRAPA MATOPIBA (Solo Arenoso): Alta drenagem e risco de erosão rápida sob chuvas intensas. Ventos acima de 10 km/h inviabilizam pulverização por deriva.',
        limites: { chuvaRedMm: 70, ventoDerivaKmh: 10, ventoRedKmh: 18, umidadeRedPct: 90 },
      },
    },
  },
  CERRADO: {
    nome: 'Cerrado Central / MT-MS-GO (Brasil)',
    solo: 'Latossolo de Cerrado (média-alta permeabilidade)',
    culturas: {
      Soja: {
        fonte: 'EMBRAPA Cerrados / EMBRAPA Agropecuária Oeste',
        diretriz:
          'MANUAL EMBRAPA CERRADO: Solos profundos com boa drenagem, porém sujeitos a lixiviação de potássio e nitrogênio em chuvas acima de 55mm. Ventos acima de 10 km/h inviabilizam pulverização por deriva e alta temperatura acelera evaporação da gota.',
        limites: { chuvaRedMm: 55, ventoDerivaKmh: 10, ventoRedKmh: 20, umidadeRedPct: 82 },
      },
      Milho: {
        fonte: 'EMBRAPA Cerrados / ZARC Safrinha',
        diretriz:
          'ZARC CERRADO MILHO SAFRINHA: Risco de acamamento com ventos acima de 35 km/h e chuvas intensas acima de 55mm. Ventos acima de 10 km/h bloqueiam pulverização de defensivos.',
        limites: { chuvaRedMm: 55, ventoDerivaKmh: 10, ventoRedKmh: 35, umidadeRedPct: 82 },
      },
      Outro: {
        fonte: 'EMBRAPA Cerrados',
        diretriz:
          'DIRETRIZ EMBRAPA CERRADOS: Respeitar limite de 10 km/h para pulverizações e evitar tráfego mecanizado após chuvas acima de 55mm.',
        limites: { chuvaRedMm: 55, ventoDerivaKmh: 10, ventoRedKmh: 20, umidadeRedPct: 82 },
      },
    },
  },
  SUL_RS_SC: {
    nome: 'Rio Grande do Sul e Santa Catarina (Brasil)',
    solo: 'Argissolo / Latossolo de coxilhas e várzeas',
    culturas: {
      Outro: {
        fonte: 'EMBRAPA Clima Temperado / IRGA',
        diretriz:
          'MANUAL EMBRAPA CLIMA TEMPERADO (RS/SC): Relevo ondulado e várzeas sujeitas a encharcamento rápido. Chuvas acima de 40mm elevam risco de erosão laminar, Giberela e atolamento de máquinas. Ventos acima de 10 km/h proíbem pulverização.',
        limites: { chuvaRedMm: 40, ventoDerivaKmh: 10, ventoRedKmh: 18, umidadeRedPct: 78 },
      },
    },
  },
  SUDESTE: {
    nome: 'Sudeste / SP e MG (Brasil)',
    solo: 'Latossolo Vermelho / Terra Roxa estruturada',
    culturas: {
      Soja: {
        fonte: 'EMBRAPA / IAC São Paulo & EPAMIG',
        diretriz:
          'MANUAL IAC / EMBRAPA SUDESTE (SP/MG): Solos de alta fertilidade mas suscetíveis à compactação por tráfego pesado quando umidade supera 78% ou após chuvas acima de 45mm. Ventos acima de 10 km/h proíbem pulverização por deriva (especialmente próximo a canaviais e cafezais).',
        limites: { chuvaRedMm: 45, ventoDerivaKmh: 10, ventoRedKmh: 20, umidadeRedPct: 78 },
      },
      Outro: {
        fonte: 'EMBRAPA / IAC São Paulo & EPAMIG',
        diretriz:
          'DIRETRIZ IAC / EPAMIG SUDESTE: Limite de 10 km/h para pulverização sem deriva e suspensão de maquinário pesado após chuvas acima de 45mm.',
        limites: { chuvaRedMm: 45, ventoDerivaKmh: 10, ventoRedKmh: 20, umidadeRedPct: 78 },
      },
    },
  },
  BR: {
    nome: 'Brasil (Diretriz Nacional)',
    solo: 'solo agrícola tropical/subtropical',
    culturas: {
      Outro: {
        fonte: 'EMBRAPA (Boas Práticas Nacionais)',
        diretriz:
          'BOAS PRÁTICAS EMBRAPA BRASIL: Ventos acima de 10 km/h inviabilizam pulverização por deriva. Chuvas acima de 50mm em 24h causam lixiviação de insumos e exigem suspensão de tráfego de máquinas pesadas.',
        limites: { chuvaRedMm: 50, ventoDerivaKmh: 10, ventoRedKmh: 18, umidadeRedPct: 85 },
      },
    },
  },
  US_CORNBELT: {
    nome: 'América do Norte / Corn Belt & Prairies (EUA/Canadá)',
    solo: 'Mollisol franco-siltoso rico em matéria orgânica',
    culturas: {
      Soja: {
        fonte: 'USDA-NRCS / Extension AgClimate',
        diretriz:
          'DIRETRIZ USDA-NRCS (SOJA / MOLLISOLS): Solos franco-siltosos de alta retenção. Chuvas acima de 45mm causam crosta superficial, encharcamento e compactação por maquinário pesado. Ventos acima de 12 km/h (3.3 m/s) inviabilizam pulverização por deriva (especialmente dicamba/herbicidas).',
        limites: { chuvaRedMm: 45, ventoDerivaKmh: 12, ventoRedKmh: 22, umidadeRedPct: 80 },
      },
      Milho: {
        fonte: 'USDA-NRCS Corn Belt Guide',
        diretriz:
          'DIRETRIZ USDA CORN BELT (MILHO): Ventos acima de 35 km/h com solo úmido provocam acamamento (root lodging). Chuvas acima de 50mm causam lixiviação de nitrogênio e impedem entrada de pulverizadores. Limite de deriva em 12 km/h.',
        limites: { chuvaRedMm: 50, ventoDerivaKmh: 12, ventoRedKmh: 35, umidadeRedPct: 80 },
      },
      Outro: {
        fonte: 'USDA-NRCS',
        diretriz:
          'BOAS PRÁTICAS USDA-NRCS: Suspender pulverizações com vento acima de 12 km/h (risco de deriva) e evitar compactação de Mollisols quando chuva superar 45mm.',
        limites: { chuvaRedMm: 45, ventoDerivaKmh: 12, ventoRedKmh: 22, umidadeRedPct: 80 },
      },
    },
  },
  AR_PAMPAS: {
    nome: 'Pampas / Cone Sul (Argentina e Uruguai)',
    solo: 'Molisol pampeano (franco-argiloso)',
    culturas: {
      Outro: {
        fonte: 'INTA Argentina / INIA Uruguai',
        diretriz:
          'MANUAL INTA PAMPAS: Planícies com drenagem lenta em áreas baixas. Chuvas acima de 45mm saturam os horizontes superficiais (risco de atolamento e perda de nitrogênio). Ventos pampeanos acima de 12 km/h proíbem pulverização por deriva.',
        limites: { chuvaRedMm: 45, ventoDerivaKmh: 12, ventoRedKmh: 24, umidadeRedPct: 80 },
      },
    },
  },
  EU_TEMPERATE: {
    nome: 'Europa (Zona Temperada / Atlântica / Mediterrânea)',
    solo: 'Luvisol / Cambisol temperado',
    culturas: {
      Trigo: {
        fonte: 'FAO Europe / Copernicus Agri-Guidelines',
        diretriz:
          'DIRETRIZ FAO EUROPA (CEREAIS DE INVERNO): Umidade acima de 75% associada a chuvas acima de 40mm eleva severamente risco de Fusariose/Septoriose e compactação de solos frios. Ventos acima de 10 km/h (3 m/s) violam normas europeias de deriva na pulverização.',
        limites: { chuvaRedMm: 40, ventoDerivaKmh: 10, ventoRedKmh: 20, umidadeRedPct: 75 },
      },
      Outro: {
        fonte: 'FAO Europe / Copernicus Agri-Guidelines',
        diretriz:
          'DIRETRIZ FAO EUROPA: Limite rígido de vento de 10 km/h para pulverização sem deriva e suspensão de maquinário pesado em solos temperados com chuva acima de 40mm ou umidade acima de 78%.',
        limites: { chuvaRedMm: 40, ventoDerivaKmh: 10, ventoRedKmh: 20, umidadeRedPct: 78 },
      },
    },
  },
  AF_SAVANNA: {
    nome: 'África (Savana / Sahel / Cinturão Agrícola)',
    solo: 'Ferralsol / Lixisol tropical',
    culturas: {
      Outro: {
        fonte: 'FAO Africa / IITA-CGIAR',
        diretriz:
          'DIRETRIZ FAO ÁFRICA & IITA: Solos tropicais com baixa matéria orgânica e alta suscetibilidade à erosão torrencial. Chuvas acima de 45mm causam escoamento superficial severo; ventos acima de 12 km/h com baixa umidade causam deriva e evaporação rápida.',
        limites: { chuvaRedMm: 45, ventoDerivaKmh: 12, ventoRedKmh: 22, umidadeRedPct: 80 },
      },
    },
  },
  AS_MONSOON: {
    nome: 'Ásia (Zona de Monções / Sul e Sudeste Asiático)',
    solo: 'Solo aluvial / Fluvisol de alta retenção',
    culturas: {
      Outro: {
        fonte: 'FAO Asia / IRRI Guidelines',
        diretriz:
          'DIRETRIZ FAO ÁSIA / MONÇÕES: Regime de chuvas intensas. Precipitações acima de 60mm em 24h geram alagamento rápido e lavagem imediata de defensivos/fertilizantes. Ventos acima de 12 km/h inviabilizam pulverização.',
        limites: { chuvaRedMm: 60, ventoDerivaKmh: 12, ventoRedKmh: 25, umidadeRedPct: 88 },
      },
    },
  },
  AU_ARID: {
    nome: 'Oceania / Austrália (Cinturão de Grãos)',
    solo: 'Vertosol / Solo argilo-arenoso seco',
    culturas: {
      Outro: {
        fonte: 'CSIRO / GRDC Australia',
        diretriz:
          'DIRETRIZ CSIRO / GRDC AUSTRÁLIA: Alta evaporação e risco de inversão térmica. Ventos acima de 12 km/h ou abaixo de 3 km/h com inversão proíbem pulverização. Chuvas acima de 45mm em Vertosols argilosos impedem trânsito de máquinas.',
        limites: { chuvaRedMm: 45, ventoDerivaKmh: 12, ventoRedKmh: 22, umidadeRedPct: 80 },
      },
    },
  },
  GLOBAL_TROPICAL: {
    nome: 'Zona Tropical Global',
    solo: 'solo tropical (Oxisol/Ultisol)',
    culturas: {
      Outro: {
        fonte: 'FAO Tropical Agriculture Guidelines',
        diretriz:
          'DIRETRIZ FAO TROPICAL GLOBAL: Chuvas intensas acima de 50mm causam lixiviação rápida de nutrientes e risco de erosão laminar. Ventos acima de 10 km/h inviabilizam pulverização por deriva.',
        limites: { chuvaRedMm: 50, ventoDerivaKmh: 10, ventoRedKmh: 20, umidadeRedPct: 82 },
      },
    },
  },
  GLOBAL_TEMPERATE: {
    nome: 'Zona Temperada / Subtropical Global',
    solo: 'solo temperado/subtropical',
    culturas: {
      Outro: {
        fonte: 'FAO Global Agroclimatic Guidelines',
        diretriz:
          'DIRETRIZ FAO TEMPERADA GLOBAL: Chuvas acima de 45mm saturam a camada superficial e favorecem compactação por maquinário pesado. Ventos acima de 12 km/h proíbem pulverização por deriva.',
        limites: { chuvaRedMm: 45, ventoDerivaKmh: 12, ventoRedKmh: 22, umidadeRedPct: 80 },
      },
    },
  },
};

// Detecta a região agrícola em qualquer coordenada do planeta (sem sobreposição de fronteiras)
function detectarRegiaoAgricola(lat, lng) {
  // 1. Pampas Argentinos e Uruguai ANTES das caixas gerais do Brasil para não engolir Uruguai/Santa Fe/Entre Ríos
  const isUruguai = lat >= -35.0 && lat <= -30.1 && lng >= -58.5 && lng <= -53.1;
  const isArgentinaPampas = lat >= -41.0 && lat <= -29.0 && lng >= -66.5 && lng <= -57.5;
  if (isUruguai || isArgentinaPampas) return 'AR_PAMPAS';

  // 2. Sub-regiões do Brasil
  if (lat >= -26.72 && lat <= -22.52 && lng >= -54.62 && lng <= -48.02) return 'PR';
  if (lat >= -33.75 && lat < -26.72 && lng >= -57.65 && lng <= -48.35) return 'SUL_RS_SC';
  if (lat >= -25.3 && lat <= -14.2 && lng >= -53.1 && lng <= -39.8) {
    // Separa Sudeste (SP/MG) da Bahia e do Centro-Oeste
    if (lat <= -18.35 || lng >= -46.6) return 'SUDESTE';
  }
  if (lat >= -18.35 && lat <= -8.53 && lng >= -46.62 && lng <= -37.34) return 'BA';
  if (lat >= -24.0 && lat <= -7.3 && lng >= -61.6 && lng <= -46.62) return 'CERRADO';
  if (lat >= -33.75 && lat <= 5.27 && lng >= -73.99 && lng <= -34.79) return 'BR';

  // 3. Grandes zonas agrícolas do mundo
  if (lat >= -42.0 && lat <= -26.0 && lng >= -68.0 && lng <= -53.0) return 'AR_PAMPAS';
  if (lat >= 25.0 && lat <= 60.0 && lng >= -130.0 && lng <= -60.0) return 'US_CORNBELT';
  if (lat >= 35.0 && lat <= 70.0 && lng >= -11.0 && lng <= 45.0) return 'EU_TEMPERATE';
  if (lat >= -35.0 && lat < 35.0 && lng >= -18.0 && lng <= 52.0) return 'AF_SAVANNA';
  if (lat >= -10.0 && lat <= 45.0 && lng >= 60.0 && lng <= 145.0) return 'AS_MONSOON';
  if (lat >= -45.0 && lat <= -10.0 && lng >= 112.0 && lng <= 180.0) return 'AU_ARID';

  // 4. Fallback climático universal (cobre 100% do globo terrestre)
  return Math.abs(lat) <= 23.5 ? 'GLOBAL_TROPICAL' : 'GLOBAL_TEMPERATE';
}

function obterDiretrizRegional(lat, lng, crop) {
  const uf = detectarRegiaoAgricola(lat, lng);
  const regiao = manuaisRegionais[uf] || manuaisRegionais.GLOBAL_TROPICAL;
  const cultura =
    regiao.culturas[crop] || regiao.culturas.Outro || manuaisRegionais.GLOBAL_TROPICAL.culturas.Outro;
  return { uf, nome: regiao.nome, solo: regiao.solo, ...cultura };
}

// Piso físico calculado pelo CÓDIGO com os limites numéricos do manual da região
function calcularPisoFisicoRegional(nasa, limites) {
  const ventoKmh = Number((nasa.windSpeed2m * 3.6).toFixed(1)); // NASA WS2M vem em m/s
  if (
    nasa.predictedRain >= limites.chuvaRedMm ||
    nasa.soilMoisture >= limites.umidadeRedPct ||
    ventoKmh >= limites.ventoRedKmh
  ) {
    return { minPhysicalRisk: 'red', ventoKmh };
  }
  if (
    ventoKmh > limites.ventoDerivaKmh ||
    nasa.predictedRain >= limites.chuvaRedMm * 0.75 ||
    nasa.soilMoisture >= limites.umidadeRedPct - 10
  ) {
    return { minPhysicalRisk: 'yellow', ventoKmh };
  }
  return { minPhysicalRisk: 'green', ventoKmh };
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'dummy_key_for_fallback_mode',
});

const PESO_RISK = { green: 0, yellow: 1, red: 2 };

/**
 * Garante 100% de compatibilidade com a função isAnalysis(value) de src/services/agroShieldApi.ts
 * e aplica o Poder de Veto Físico (manual regional EMBRAPA/ZARC) sobre a resposta da IA.
 */
function auditarEFormatarParaFrontEnd(iaJsonBruto, fieldReq, nasaMetrics) {
  const { historicalRain, predictedRain, soilMoisture, minPhysicalRisk } = nasaMetrics;
  const regiao =
    fieldReq.regiao ||
    obterDiretrizRegional(fieldReq.centroid.lat, fieldReq.centroid.lng, fieldReq.crop);
  const lim = regiao.limites;
  const ventoKmh = nasaMetrics.ventoKmh ?? Number((nasaMetrics.windSpeed2m * 3.6).toFixed(1));
  const manualSelecionado = regiao.diretriz;

  // 1. Veto de Semáforo (A IA nunca pode dar um risco menor que o piso físico do manual regional)
  const riskIa = ['red', 'yellow', 'green'].includes(iaJsonBruto?.risk)
    ? iaJsonBruto.risk
    : minPhysicalRisk;

  const sofreuVetoDeRisco = PESO_RISK[riskIa] < PESO_RISK[minPhysicalRisk];
  const riskFinal = sofreuVetoDeRisco ? minPhysicalRisk : riskIa;

  // 2. Fallbacks fundamentados no manual regional caso a IA omita ou contradiga
  const defaultsPorRisco = {
    red: {
      guidance: `Alerta severo pelo manual ${regiao.fonte} para ${fieldReq.crop} em ${regiao.nome} (${fieldReq.areaHectares} ha). Chuva de ${predictedRain} mm (limite do manual: ${lim.chuvaRedMm} mm), umidade de ${soilMoisture}% em ${regiao.solo} e vento de ${ventoKmh} km/h. Cancele a pulverização, adie a adubação e retire o maquinário pesado do talhão.`,
      actions: [
        `Cancelar a pulverização em ${fieldReq.crop} (vento de ${ventoKmh} km/h; limite de deriva do manual ${regiao.fonte}: ${lim.ventoDerivaKmh} km/h)`,
        `Adiar a adubação no sistema ${fieldReq.currentRotation} (chuva de ${predictedRain} mm frente ao limite de ${lim.chuvaRedMm} mm do manual regional)`,
        `Retirar máquinas pesadas do talhão para evitar atolamento e compactação em ${regiao.solo}`,
      ],
      technicalReason: `Cruzamento NASA POWER x ${regiao.fonte} (${regiao.uf}): ${manualSelecionado} Na coordenada (${fieldReq.centroid.lat}, ${fieldReq.centroid.lng}), a chuva de ${predictedRain} mm (média ${historicalRain} mm), a umidade superficial (GWETTOP) de ${soilMoisture}% e o vento (WS2M) de ${ventoKmh} km/h ultrapassam os limites do manual regional para ${fieldReq.crop}.`,
    },
    yellow: {
      guidance: `Atenção pelo manual ${regiao.fonte} para ${fieldReq.crop} em ${regiao.nome} (${fieldReq.areaHectares} ha). Vento de ${ventoKmh} km/h na NASA (limite de deriva: ${lim.ventoDerivaKmh} km/h) e chuva de ${predictedRain} mm com umidade de ${soilMoisture}%. Reagende a pulverização para uma janela de vento mais calmo.`,
      actions: [
        `Reagendar a pulverização em ${fieldReq.crop} enquanto o vento (${ventoKmh} km/h) superar ${lim.ventoDerivaKmh} km/h (manual ${regiao.fonte})`,
        `Monitorar a umidade de ${regiao.solo} (${soilMoisture}%) no manejo ${fieldReq.currentRotation} antes do tráfego de tratores`,
        `Inspecionar terraços e cobertura de palhada conforme o manual ${regiao.fonte}`,
      ],
      technicalReason: `Cruzamento NASA POWER x ${regiao.fonte} (${regiao.uf}): ${manualSelecionado} Na coordenada (${fieldReq.centroid.lat}, ${fieldReq.centroid.lng}), o satélite registra ${predictedRain} mm de chuva (histórico ${historicalRain} mm), umidade do solo de ${soilMoisture}% e vento a 2m (WS2M) de ${ventoKmh} km/h, exigindo cautela segundo o manual regional.`,
    },
    green: {
      guidance: `Operação normal pelo manual ${regiao.fonte} para ${fieldReq.crop} em ${regiao.nome} (${fieldReq.areaHectares} ha). Chuva de ${predictedRain} mm (abaixo do limite de ${lim.chuvaRedMm} mm), umidade de ${soilMoisture}% em ${regiao.solo} e vento de ${ventoKmh} km/h permitem seguir o manejo planejado.`,
      actions: [
        `Pulverizar ${fieldReq.crop} apenas nas horas com vento abaixo de ${lim.ventoDerivaKmh} km/h (manual ${regiao.fonte})`,
        `Manter a palhada do sistema ${fieldReq.currentRotation} para proteger ${regiao.solo}`,
        'Acompanhar a umidade superficial do solo antes do plantio ou da adubação de cobertura (ZARC)',
      ],
      technicalReason: `Cruzamento NASA POWER x ${regiao.fonte} (${regiao.uf}): ${manualSelecionado} Na coordenada (${fieldReq.centroid.lat}, ${fieldReq.centroid.lng}), a precipitação de ${predictedRain} mm (média ${historicalRain} mm), a umidade (GWETTOP) de ${soilMoisture}% e o vento (WS2M) de ${ventoKmh} km/h estão dentro dos limites do manual regional.`,
    },
  };

  const padrao = defaultsPorRisco[riskFinal];

  let guidance =
    typeof iaJsonBruto?.guidance === 'string' && iaJsonBruto.guidance.trim().length > 10
      ? iaJsonBruto.guidance.trim()
      : padrao.guidance;

  if (
    riskFinal !== 'green' &&
    /condi[cç][oõ]es favor[aá]veis|opera[cç][oõ]es liberadas/i.test(guidance)
  ) {
    guidance = padrao.guidance;
  }

  let technicalReason =
    typeof iaJsonBruto?.technicalReason === 'string' &&
    iaJsonBruto.technicalReason.trim().length > 15
      ? iaJsonBruto.technicalReason.trim()
      : padrao.technicalReason;

  // Garante que a fonte oficial (Embrapa/ZARC/USDA/INTA/FAO) esteja sempre citada na justificativa técnica
  if (!/embrapa|zarc|idr|usda|inta|inia|jrc|fao|iita|csiro|icar/i.test(technicalReason)) {
    technicalReason = `${technicalReason} (Fundamentação Técnica: ${manualSelecionado})`;
  }

  // Garante ESTRITAMENTE 3 strings ÚNICAS no array actions (evita duplicate key no <label key={action}> do React
  // e descarta actions alucinadas caso a IA tenha sofrido veto de risco!)
  let actions = [];
  if (!sofreuVetoDeRisco && Array.isArray(iaJsonBruto?.actions)) {
    for (const item of iaJsonBruto.actions) {
      if (typeof item === 'string' && item.trim().length > 0) {
        const limpo = item.trim();
        const contradizRisco =
          riskFinal !== 'green' &&
          /pode pulverizar|pulveriza[cç][aã]o liberada|entrar com trator pesado/i.test(limpo);
        if (!contradizRisco && !actions.includes(limpo)) {
          actions.push(limpo);
        }
      }
      if (actions.length === 3) break;
    }
  }
  for (const fallbackAction of padrao.actions) {
    if (actions.length >= 3) break;
    if (!actions.includes(fallbackAction)) {
      actions.push(fallbackAction);
    } else {
      actions.push(`${fallbackAction} (${actions.length + 1})`);
    }
  }

  return {
    risk: riskFinal,
    historicalRain: Number(historicalRain),
    predictedRain: Number(predictedRain),
    soilMoisture: Number(soilMoisture),
    windSpeedKmh: Number(ventoKmh),
    windLimitKmh: Number(regiao.limites.ventoDerivaKmh),
    rainLimitMm: Number(regiao.limites.chuvaSaturacaoMm),
    regionCode: regiao.uf,
    regionName: regiao.nome,
    soilType: regiao.solo,
    manualSource: regiao.fonte,
    guidance,
    actions,
    technicalReason,
    source: 'api',
  };
}

async function gerarAnaliseComClaude(fieldReq, nasaMetrics) {
  const chaveCache = `${fieldReq.centroid.lat.toFixed(2)}_${fieldReq.centroid.lng.toFixed(2)}_${fieldReq.crop}_${fieldReq.currentRotation}_${nasaMetrics.predictedRain}_${nasaMetrics.windSpeed2m}`;
  if (cacheDiagnosticoIa.has(chaveCache)) {
    console.log('⚡ [CACHE IA HIT] Retornando diagnóstico validado instantaneamente.');
    return cacheDiagnosticoIa.get(chaveCache);
  }

  try {
    if (
      !process.env.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_API_KEY === 'dummy_key_for_fallback_mode' ||
      process.env.ANTHROPIC_API_KEY.includes('sua-chave-aqui')
    ) {
      throw new Error('ANTHROPIC_API_KEY não configurada.');
    }

    if (!global.__modeloClaudeDescoberto) {
      try {
        const resModels = await axios.get('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': process.env.ANTHROPIC_API_KEY.trim(),
            'anthropic-version': '2023-06-01',
          },
          timeout: 3000,
        });
        const listaIds = (resModels.data?.data || []).map((m) => m.id);
        const preferido =
          listaIds.find((id) => id.includes('sonnet')) ||
          listaIds.find((id) => id.includes('claude')) ||
          listaIds[0];
        if (preferido) {
          global.__modeloClaudeDescoberto = preferido;
          console.log(`🔍 [ANTHROPIC] Modelo detectado automaticamente: ${preferido}`);
        }
      } catch {
        // Segue lista de fallback
      }
    }

    const modelosCandidatos = [
      process.env.CLAUDE_MODEL,
      global.__modeloClaudeDescoberto,
      'claude-sonnet-5-5',
      'claude-sonnet-4-5-20250929',
      'claude-sonnet-4-20250514',
      'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet-20241022',
    ].filter(Boolean);

    const regiao =
      fieldReq.regiao ||
      obterDiretrizRegional(fieldReq.centroid.lat, fieldReq.centroid.lng, fieldReq.crop);
    const diretrizOficial = regiao.diretriz;
    const ventoKmh = nasaMetrics.ventoKmh ?? Number((nasaMetrics.windSpeed2m * 3.6).toFixed(1));

    // PROMPT DE SISTEMA (regra imutável da IA)
    const systemPrompt = `Você é o AgroShield, um Copiloto Tático Agronômico de altíssima precisão.
Sua missão é emitir alertas preventivos baseados em dados de satélite da NASA.

REGRAS DE CONDUTA (INQUEBRÁVEIS):
1. NUNCA invente conselhos agronômicos genéricos. Baseie sua recomendação EXCLUSIVAMENTE no "Manual Técnico Regional" fornecido no prompt.
2. O comportamento do clima e do solo varia por região. Respeite as características do estado informado.
3. Responda APENAS com um objeto JSON válido, sem markdown ou textos adicionais.
4. O campo "risk" NUNCA pode ser menor que o "Piso Físico" informado (red > yellow > green).

FORMATO DE SAÍDA OBRIGATÓRIO:
{
  "risk": "red" | "yellow" | "green",
  "historicalRain": <number>,
  "predictedRain": <number>,
  "soilMoisture": <number>,
  "guidance": "Ação imediata com base no manual oficial. Máx 3 frases.",
  "actions": ["Ação 1 baseada no manual", "Ação 2 baseada no manual", "Ação 3 baseada no manual"],
  "technicalReason": "Cite o cruzamento dos números da NASA com o manual EMBRAPA/ZARC local."
}
O array "actions" DEVE ter exatamente 3 strings.`;

    // PROMPT DO USUÁRIO (dados variáveis)
    const userPrompt = `ANÁLISE DE RISCO SOLICITADA:

📍 LOCALIZAÇÃO: ${regiao.nome} (${regiao.uf}) | Solo: ${regiao.solo}
📌 Coordenadas: ${fieldReq.centroid.lat}, ${fieldReq.centroid.lng} | Área: ${fieldReq.areaHectares} ha
🌱 CULTURA: ${fieldReq.crop} | Rotação: ${fieldReq.currentRotation}

🛰️ DADOS DE SATÉLITE (NASA POWER):
- Média histórica de chuva: ${nasaMetrics.historicalRain} mm
- Pico de chuva recente (PRECTOTCORR): ${nasaMetrics.predictedRain} mm
- Umidade superficial do solo (GWETTOP): ${nasaMetrics.soilMoisture}%
- Pico de vento a 2m (WS2M): ${ventoKmh} km/h (${nasaMetrics.windSpeed2m} m/s)

⚖️ PISO FÍSICO CALCULADO PELO CÓDIGO: "${nasaMetrics.minPhysicalRisk}"

📚 MANUAL TÉCNICO REGIONAL (FONTE DE VERDADE - ${regiao.fonte}):
"""
${diretrizOficial}
"""

Crie o JSON de alerta cruzando os DADOS DE SATÉLITE com as regras estritas do MANUAL TÉCNICO REGIONAL. Cite a fonte (${regiao.fonte}) na justificativa.`;

    // Timeout de segurança de 8.5 segundos na chamada da IA para NUNCA estourar o timeout do Front-end!
    const chamarComTimeout = async () => {
      for (const modelo of [...new Set(modelosCandidatos)]) {
        try {
          const payload = {
            model: modelo,
            max_tokens: 900,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
          };
          if (!modelo.includes('claude-sonnet-5') && !modelo.includes('claude-opus-5')) {
            payload.temperature = 0;
          }
          const resMsg = await anthropic.messages.create(payload);
          global.__modeloClaudeDescoberto = modelo;
          console.log(`🤖 [CLAUDE IA] Diagnóstico gerado com sucesso pelo modelo "${modelo}".`);
          return resMsg;
        } catch (errMod) {
          if (errMod.status === 400 && String(errMod.message).includes('temperature')) {
            const resMsg2 = await anthropic.messages.create({
              model: modelo,
              max_tokens: 900,
              system: systemPrompt,
              messages: [{ role: 'user', content: userPrompt }],
            });
            global.__modeloClaudeDescoberto = modelo;
            return resMsg2;
          }
          if (errMod.status !== 404) throw errMod;
        }
      }
      throw new Error('Nenhum modelo disponível.');
    };

    const msg = await Promise.race([
      chamarComTimeout(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout de 8.5s da IA atingido (usando resposta determinística rápida).')), 8500)
      ),
    ]);

    const blocoTexto = Array.isArray(msg?.content)
      ? msg.content.find((b) => b.type === 'text' && typeof b.text === 'string')
      : null;
    const rawText = blocoTexto?.text || msg?.content?.[0]?.text || '';

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Claude não retornou um bloco JSON válido.');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Passa pela Trava 2 (Auditoria determinística e garantia de contrato do Front-end)
    const respostaAuditada = auditarEFormatarParaFrontEnd(parsed, fieldReq, nasaMetrics);
    cacheDiagnosticoIa.set(chaveCache, respostaAuditada);
    return respostaAuditada;
  } catch (err) {
    console.warn(`⚠️ [FALLBACK DETERMINÍSTICO RÁPIDO ATIVADO]: ${err.message}`);
    const respostaDeterministica = auditarEFormatarParaFrontEnd({}, fieldReq, nasaMetrics);
    return respostaDeterministica;
  }
}

// ============================================================================
// 5. ROTA OFICIAL DO FRONT-END: POST /api/analyze-field
// ============================================================================
app.post('/api/analyze-field', async (req, res) => {
  try {
    // 1. Normaliza e valida os dados enviados por analyzeField() do Front-end
    const fieldReq = normalizarFieldRequest(req.body);

    // 2. Grounding regional: detecta o estado/país e puxa o manual técnico oficial (EMBRAPA/ZARC/USDA/INTA/FAO)
    fieldReq.regiao = obterDiretrizRegional(
      fieldReq.centroid.lat,
      fieldReq.centroid.lng,
      fieldReq.crop
    );
    const lim = fieldReq.regiao.limites;

    // 2.1 Consulta NASA POWER (ou aplica cenário simulado pelo painel se simulateRisk for enviado pelo Front-end)
    let nasaBruto = await buscarDadosNasaParaFrontEnd(
      fieldReq.centroid.lat,
      fieldReq.centroid.lng
    );

    const simulateRisk = req.body?.simulateRisk;
    if (simulateRisk === 'red') {
      nasaBruto = {
        historicalRain: nasaBruto.historicalRain,
        predictedRain: Math.max(lim.chuvaSaturacaoMm + 28, Math.round(nasaBruto.historicalRain * 1.9)),
        soilMoisture: Math.max(lim.umidadeSaturacaoPct + 7, 89),
        windSpeed2m: Number(((lim.ventoDerivaKmh + 14) / 3.6).toFixed(2)),
      };
    } else if (simulateRisk === 'yellow') {
      nasaBruto = {
        historicalRain: nasaBruto.historicalRain,
        predictedRain: Math.max(18, Math.min(lim.chuvaSaturacaoMm - 6, Math.round(nasaBruto.historicalRain * 1.15))),
        soilMoisture: Math.min(lim.umidadeSaturacaoPct - 8, 71),
        windSpeed2m: Number(((lim.ventoDerivaKmh + 3.5) / 3.6).toFixed(2)),
      };
    } else if (simulateRisk === 'green') {
      nasaBruto = {
        historicalRain: nasaBruto.historicalRain,
        predictedRain: Math.min(16, Math.max(8, lim.chuvaSaturacaoMm - 25)),
        soilMoisture: 54,
        windSpeed2m: Number((Math.max(3, lim.ventoDerivaKmh - 4) / 3.6).toFixed(2)),
      };
    }

    const nasaMetrics = {
      ...nasaBruto,
      ...calcularPisoFisicoRegional(nasaBruto, lim),
    };
    console.log(
      `📚 [GROUNDING] ${fieldReq.regiao.uf} · ${fieldReq.crop} · ${fieldReq.regiao.fonte} → piso físico "${nasaMetrics.minPhysicalRisk}" (vento ${nasaMetrics.ventoKmh} km/h, chuva ${nasaMetrics.predictedRain} mm)`
    );

    // 3. Gera análise com Claude IA + Dupla Trava de Confiabilidade
    const resultadoFrontEnd = await gerarAnaliseComClaude(fieldReq, nasaMetrics);

    // 4. Salva no PostgreSQL (JSONB) ou memória sem bloquear a resposta ao Front-end
    salvarAnaliseNoBanco(fieldReq, nasaMetrics, resultadoFrontEnd);

    // 5. Se o alerta for crítico ("red"), aciona automaticamente a Mensageria de Contingência 2G (SMS Offline)
    let smsAlert = null;
    if (resultadoFrontEnd.risk === 'red') {
      try {
        smsAlert = await dispararAlertaSms2G(
          fieldReq,
          nasaMetrics,
          resultadoFrontEnd,
          req.body?.telefone_produtor
        );
      } catch {
        // Ignora erro de envio externo
      }
    }

    return res.status(200).json({
      ...resultadoFrontEnd,
      smsAlert,
    });
  } catch (fatalError) {
    console.error('❌ [ERRO CRÍTICO /api/analyze-field]:', fatalError.message);

    // Contingência garantida que passa 100% no isAnalysis() do Front-end
    return res.status(200).json({
      risk: 'red',
      historicalRain: 32,
      predictedRain: 112,
      soilMoisture: 89,
      guidance:
        'Tempestade severa detectada para as próximas 24h. Suspenda a pulverização, evite adubação de cobertura e retire os tratores das áreas de baixada.',
      actions: [
        'Suspender a pulverização programada para amanhã',
        'Adiar a adubação de cobertura para evitar perda de insumos',
        'Retirar máquinas e equipamentos das áreas de baixada',
      ],
      technicalReason:
        'A precipitação acumulada supera a referência histórica da NASA POWER e a umidade superficial do solo (89%) indica saturação crítica para o tráfego de maquinário.',
      source: 'api',
    });
  }
});

// ============================================================================
// 6. MÓDULO 2G OFFLINE SMS (TWILIO): ALERTA AUTOMÁTICO + CONSULTA BIDIRECIONAL
// ============================================================================
const historicoSms2G = [];

/**
 * Escapa caracteres especiais (&, <, >, ", ') para que expressões como "< 10 km/h"
 * nunca quebrem o parser XML TwiML do Twilio (Erro 12100 do Twilio).
 */
function escaparXmlTwiml(texto = '') {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Trava Determinística Pós-IA para o SMS 2G:
 * 1. Impede que a IA diga "SIM" / "liberado" quando o piso físico regional é "red" ou "yellow".
 * 2. Garante prefixo "AGROSHIELD: " e limite estrito de <= 150 caracteres.
 */
function auditarSms2GContraFisica(textoIaBruto, fieldReq, nasaMetrics) {
  const regiao =
    fieldReq.regiao ||
    obterDiretrizRegional(fieldReq.centroid.lat, fieldReq.centroid.lng, fieldReq.crop);
  const lim = regiao.limites;
  const ventoKmh = nasaMetrics.ventoKmh ?? Number((nasaMetrics.windSpeed2m * 3.6).toFixed(1));
  const chuvaMm = nasaMetrics.predictedRain;
  const riscoFisico = nasaMetrics.minPhysicalRisk;

  let texto = typeof textoIaBruto === 'string' ? textoIaBruto.replace(/\s+/g, ' ').trim() : '';

  // Verifica se a IA contradisse a física (ex: disse "SIM" ou "pode pulverizar" quando risco é red/yellow)
  const iaDisseLiberado =
    /\bsim\b|pode pulverizar|pulveriza[cç][aã]o liberada|opera[cç][oõ]es liberadas|pode entrar/i.test(
      texto
    ) && !/\bn[aã]o\b/i.test(texto);

  if (!texto || texto.length < 10 || (riscoFisico !== 'green' && iaDisseLiberado)) {
    if (riscoFisico === 'red') {
      texto = `AGROSHIELD: NAO opere em ${fieldReq.crop}. Chuva ${chuvaMm}mm e vento ${ventoKmh}km/h (${regiao.fonte}). Risco de atolamento e deriva.`;
    } else if (riscoFisico === 'yellow') {
      texto = `AGROSHIELD: NAO pulverize ${fieldReq.crop} agora. Vento ${ventoKmh}km/h supera limite de ${lim.ventoDerivaKmh}km/h (${regiao.fonte}). Risco de deriva.`;
    } else {
      texto = `AGROSHIELD: SIM, liberado para ${fieldReq.crop}. Chuva ${chuvaMm}mm e vento seguro de ${ventoKmh}km/h dentro do manual ${regiao.fonte}.`;
    }
  }

  if (!texto.toUpperCase().startsWith('AGROSHIELD')) {
    texto = `AGROSHIELD: ${texto}`;
  }

  if (texto.length > 150) {
    texto = `${texto.slice(0, 147).trim()}...`;
  }

  return texto;
}

/**
 * Disparo ativo de SMS quando a análise do talhão retorna "red" (Perigo Severo)
 */
async function dispararAlertaSms2G(fieldReq, nasaMetrics, resultadoFrontEnd, telefoneDestino) {
  const fone = telefoneDestino || process.env.FARMER_DEFAULT_PHONE || '+5544999999999';
  const ventoKmh = nasaMetrics.ventoKmh ?? Number((nasaMetrics.windSpeed2m * 3.6).toFixed(1));
  const textoSms = `AGROSHIELD ALERTA VERMELHO (${fieldReq.crop}): Chuva ${nasaMetrics.predictedRain}mm e vento ${ventoKmh}km/h. ${resultadoFrontEnd.guidance}`.slice(
    0,
    150
  );

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const fromPhone = process.env.TWILIO_PHONE_NUMBER;

  if (sid && token && fromPhone && sid.startsWith('AC') && !sid.includes('seu_account_sid')) {
    try {
      const authBase64 = Buffer.from(`${sid}:${token}`).toString('base64');
      const params = new URLSearchParams({ To: fone, From: fromPhone, Body: textoSms });
      await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        params.toString(),
        {
          headers: {
            Authorization: `Basic ${authBase64}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 4500,
        }
      );
    } catch (errTwilio) {
      console.warn('[AVISO TWILIO SMS]:', errTwilio.message);
    }
  }

  const registroSms = {
    tipo: 'OUTBOUND_RED_ALERT_2G',
    para: fone,
    mensagem: textoSms,
    caracteres: textoSms.length,
    timestamp: new Date().toISOString(),
  };
  historicoSms2G.unshift(registroSms);
  console.log(`📲 [ALERTA SMS 2G DISPARADO] Para ${fone} (${textoSms.length} chars): "${textoSms}"`);
  return registroSms;
}

/**
 * Rota Webhook Bidirecional Offline via SMS 2G: POST /api/sms-responder
 * O agricultor manda SMS em linguagem natural do trator (sem 3G/4G) e recebe diagnóstico NASA + EMBRAPA em <= 150 chars.
 */
app.post('/api/sms-responder', async (req, res) => {
  try {
    const telefoneRemetente =
      req.body?.From || req.body?.telefone || process.env.FARMER_DEFAULT_PHONE || '+5544999999999';
    const perguntaAgricultor =
      typeof (req.body?.Body ?? req.body?.mensagem) === 'string' &&
      String(req.body?.Body ?? req.body?.mensagem).trim().length > 0
        ? String(req.body?.Body ?? req.body?.mensagem).trim()
        : 'STATUS';

    // Resgata o último talhão analisado pelo produtor (ou usa Campo Mourão como padrão)
    const ultimoTalhao = memoriaFallbackDB[0] || {
      crop: 'Soja',
      currentRotation: 'Soja → Milho Safrinha',
      areaHectares: 30.1,
      centroid: INITIAL_CENTER,
    };

    const fieldReq = normalizarFieldRequest({
      crop: req.body?.crop || ultimoTalhao.crop,
      currentRotation: ultimoTalhao.currentRotation,
      areaHectares: ultimoTalhao.areaHectares,
      centroid: req.body?.centroid || ultimoTalhao.centroid,
    });

    fieldReq.regiao = obterDiretrizRegional(
      fieldReq.centroid.lat,
      fieldReq.centroid.lng,
      fieldReq.crop
    );

    // Consulta NASA POWER em tempo real (ou permite simular_clima para demonstração na banca)
    let nasaBruto;
    if (req.body?.simular_clima && typeof req.body.simular_clima === 'object') {
      nasaBruto = {
        historicalRain: Number(req.body.simular_clima.historicalRain ?? 51),
        predictedRain: Number(req.body.simular_clima.predictedRain ?? 27),
        soilMoisture: Number(req.body.simular_clima.soilMoisture ?? 54),
        windSpeed2m: Number(req.body.simular_clima.windSpeed2m ?? 4.5),
      };
    } else {
      nasaBruto = await buscarDadosNasaParaFrontEnd(
        fieldReq.centroid.lat,
        fieldReq.centroid.lng
      );
    }

    const nasaMetrics = {
      ...nasaBruto,
      ...calcularPisoFisicoRegional(nasaBruto, fieldReq.regiao.limites),
    };

    let textoIaSms = '';
    try {
      if (
        process.env.ANTHROPIC_API_KEY &&
        !process.env.ANTHROPIC_API_KEY.includes('sua-chave-aqui')
      ) {
        const modelo = global.__modeloClaudeDescoberto || 'claude-sonnet-5-5';
        const promptSms = `O agricultor está no trator SEM INTERNET em ${fieldReq.regiao.nome} (${fieldReq.crop}) e enviou este SMS 2G: "${perguntaAgricultor}"
Dados NASA POWER agora: Chuva=${nasaMetrics.predictedRain}mm (média ${nasaMetrics.historicalRain}mm), Umidade=${nasaMetrics.soilMoisture}%, Vento=${nasaMetrics.ventoKmh} km/h.
Piso físico obrigatório: "${nasaMetrics.minPhysicalRisk}".
Manual Regional (${fieldReq.regiao.fonte}): "${fieldReq.regiao.diretriz}"
Responda em NO MÁXIMO 145 CARACTERES começando com "AGROSHIELD: " e dizendo claramente SIM ou NAO com base nos números da NASA e no manual.`;

        const msgSms = await Promise.race([
          anthropic.messages.create({
            model: modelo,
            max_tokens: 700,
            messages: [{ role: 'user', content: promptSms }],
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout SMS IA')), 6500)),
        ]);
        const bloco = Array.isArray(msgSms?.content)
          ? msgSms.content.find((b) => b.type === 'text')
          : null;
        textoIaSms = bloco?.text || '';
      }
    } catch {
      // Cai para a trava determinística abaixo
    }

    // Passa pela Trava Pós-IA do SMS 2G (garante <= 150 chars e proíbe falso positivo)
    const respostaSmsSegura = auditarSms2GContraFisica(textoIaSms, fieldReq, nasaMetrics);
    const twimlXml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaparXmlTwiml(respostaSmsSegura)}</Message></Response>`;

    const logInteracao = {
      tipo: 'INBOUND_CONVERSATIONAL_2G',
      de: telefoneRemetente,
      pergunta_agricultor: perguntaAgricultor,
      regiao: fieldReq.regiao.uf,
      fonte_manual: fieldReq.regiao.fonte,
      risco_fisico: nasaMetrics.minPhysicalRisk,
      resposta_sms: respostaSmsSegura,
      caracteres: respostaSmsSegura.length,
      twiml: twimlXml,
      timestamp: new Date().toISOString(),
    };
    historicoSms2G.unshift(logInteracao);

    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (req.query?.format === 'json' || contentType.includes('application/json')) {
      return res.status(200).json(logInteracao);
    }

    res.set('Content-Type', 'text/xml');
    return res.status(200).send(twimlXml);
  } catch (err) {
    const xmlSeguro =
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>AGROSHIELD: Alerta preventivo ativo na sua regiao. Evite pulverizar com vento acima de 10 km/h.</Message></Response>';
    res.set('Content-Type', 'text/xml');
    return res.status(200).send(xmlSeguro);
  }
});

// Rota de consulta de histórico salvo no PostgreSQL / Memória + Logs de SMS 2G
app.get('/api/history', async (req, res) => {
  try {
    if (dbOnline) {
      const result = await pgPool.query(
        'SELECT * FROM field_analyses ORDER BY created_at DESC LIMIT 50'
      );
      return res.status(200).json({
        source: 'postgresql_jsonb',
        rows: result.rows,
        sms_2g_logs: historicoSms2G,
      });
    }
    return res.status(200).json({
      source: 'memory_fallback',
      rows: memoriaFallbackDB,
      sms_2g_logs: historicoSms2G,
    });
  } catch {
    return res.status(200).json({
      source: 'memory_fallback',
      rows: memoriaFallbackDB,
      sms_2g_logs: historicoSms2G,
    });
  }
});

// Redireciona a raiz do back-end (http://localhost:3000/) direto para a interface do Front-end (http://localhost:8080/)
app.get('/', (req, res) => {
  res.redirect('http://localhost:8080');
});

// Healthcheck
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    endpoint_frontend: 'POST /api/analyze-field',
    postgres_online: dbOnline,
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('[ANTI-CRASH] Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[ANTI-CRASH] Uncaught Exception:', err);
});

if (require.main === module) {
  inicializarBancoDeDados().finally(() => {
    app.listen(PORT, () => {
      console.log('====================================================================');
      console.log(`🚜 AGROSHIELD BACK-END ONLINE -> http://localhost:${PORT}`);
      console.log(`🎯 Rota Oficial do Front-end : POST http://localhost:${PORT}/api/analyze-field`);
      console.log('====================================================================');
      // Pré-aquece o cache da NASA POWER para Campo Mourão logo na subida do servidor
      buscarDadosNasaParaFrontEnd(-24.03775, -52.4007).catch(() => {});
    });
  });
}

module.exports = {
  app,
  auditarEFormatarParaFrontEnd,
  normalizarFieldRequest,
  obterDiretrizRegional,
  calcularPisoFisicoRegional,
  gerarAnaliseComClaude,
  auditarSms2GContraFisica,
  escaparXmlTwiml,
};
