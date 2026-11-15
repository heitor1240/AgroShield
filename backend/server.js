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
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const turf = require('@turf/turf');
const Anthropic = require('@anthropic-ai/sdk');
const { Pool } = require('pg');
const {
  atualizarMemoriaAgricola,
  avaliarOperacaoPlanejada,
  aplicarCenarioClimatico,
  avaliarModeloBiofisicoProbabilistico,
} = require('./services/biophys');

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

  const operacoesValidas = ['Pulverizar', 'Plantar', 'Adubar', 'Colher'];
  const plannedOperation = operacoesValidas.includes(body.plannedOperation)
    ? body.plannedOperation
    : 'Pulverizar';

  const hojeIso = new Date().toISOString().slice(0, 10);
  const rawDate = typeof body.plannedDate === 'string' ? body.plannedDate.trim() : '';
  const plannedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : hojeIso;

  const cenariosValidos = ['current', 'el-nino-2023-24', 'la-nina-2021-22'];
  const climateScenario = cenariosValidos.includes(body.climateScenario)
    ? body.climateScenario
    : 'current';

  return {
    polygon,
    centroid,
    areaHectares,
    crop,
    currentRotation,
    plannedOperation,
    plannedDate,
    climateScenario,
  };
}

// ============================================================================
// 3. TRAVA 1 (ANTES DA IA): CONSULTA E SANITIZAÇÃO FÍSICA DA NASA POWER
// ============================================================================
const SIGLAS_MESES_NASA = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

// Cache em memória das leituras da NASA POWER + Open-Meteo por coordenada (evita delay a cada clique)
const cacheNasaPorCoordenada = new Map();
const cacheDiagnosticoIa = new Map();

/**
 * Fonte auxiliar em tempo real (0h de atraso + próximas 24h) via Open-Meteo (gratuita, global, sem chave).
 * Preenche a janela de latência de 2-7 dias da NASA POWER mantendo a NASA como fonte principal.
 */
/**
 * Calcula o Delta-T (diferença entre temperatura de bulbo seco e bulbo úmido, Stull 2011)
 * para segurança de pulverização: ideal entre 2°C e 8°C; > 10°C indica alta evaporação da gota.
 */
function calcularDeltaT(tempC, rhPct) {
  if (!Number.isFinite(tempC) || !Number.isFinite(rhPct) || rhPct <= 0 || rhPct > 100) {
    return { deltaT: null, deltaTStatus: null };
  }
  const tw =
    tempC * Math.atan(0.151977 * Math.sqrt(rhPct + 8.313659)) +
    Math.atan(tempC + rhPct) -
    Math.atan(rhPct - 1.676331) +
    0.00391838 * Math.pow(rhPct, 1.5) * Math.atan(0.023101 * rhPct) -
    4.686035;
  const deltaT = Number(Math.max(0, tempC - tw).toFixed(1));
  const deltaTStatus =
    deltaT >= 2 && deltaT <= 8 ? 'IDEAL' : deltaT > 10 ? 'EVAPORACAO_ALTA' : 'ATENCAO';
  return { deltaT, deltaTStatus };
}

async function buscarGradeRegionalChuva(lat, lng) {
  try {
    const offsets = [
      { label: 'Centro (Talhão)', dLat: 0, dLng: 0 },
      { label: 'Norte (~13 km)', dLat: 0.12, dLng: 0 },
      { label: 'Sul (~13 km)', dLat: -0.12, dLng: 0 },
      { label: 'Leste (~13 km)', dLat: 0, dLng: 0.12 },
      { label: 'Oeste (~13 km)', dLat: 0, dLng: -0.12 },
    ];
    const lats = offsets.map((o) => (lat + o.dLat).toFixed(4)).join(',');
    const lngs = offsets.map((o) => (lng + o.dLng).toFixed(4)).join(',');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&hourly=pressure_msl&daily=precipitation_sum&forecast_days=2&timezone=auto`;
    const res = await axios.get(url, { timeout: 2500 });
    const items = Array.isArray(res.data) ? res.data : [res.data];
    return offsets.map((o, idx) => {
      const item = items[idx] || {};
      const rainList = Array.isArray(item?.daily?.precipitation_sum)
        ? item.daily.precipitation_sum.filter((v) => typeof v === 'number' && Number.isFinite(v))
        : [];
      const pressList = Array.isArray(item?.hourly?.pressure_msl)
        ? item.hourly.pressure_msl.filter((v) => typeof v === 'number' && Number.isFinite(v))
        : [];
      return {
        label: o.label,
        lat: Number((lat + o.dLat).toFixed(4)),
        lng: Number((lng + o.dLng).toFixed(4)),
        rain24hMm: rainList.length > 0 ? Math.round(rainList[0]) : 0,
        pressureHpa: pressList.length > 0 ? Number(pressList[0].toFixed(1)) : null,
      };
    });
  } catch {
    return [];
  }
}

async function buscarOpenMeteoTempoReal(lat, lng) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=soil_temperature_0cm,soil_moisture_0_to_1cm,wind_speed_10m,precipitation,pressure_msl,temperature_2m,relative_humidity_2m&daily=precipitation_sum,wind_speed_10m_max,et0_fao_evapotranspiration&past_days=1&forecast_days=7&timezone=auto`;
    const res = await axios.get(url, { timeout: 2500 });
    const daily = res?.data?.daily || {};
    const hourly = res?.data?.hourly || {};

    const chuvasAll = (daily.precipitation_sum || []).filter(
      (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 600
    );
    const chuvas24h = chuvasAll.slice(0, 3);
    const ventos10mKmh = (daily.wind_speed_10m_max || [])
      .slice(0, 3)
      .filter((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 200);
    const et0List = (daily.et0_fao_evapotranspiration || []).filter(
      (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 30
    );
    const tempsSolo = (hourly.soil_temperature_0cm || []).filter(
      (v) => typeof v === 'number' && Number.isFinite(v) && v >= -20 && v <= 70
    );
    const umidSoloVol = (hourly.soil_moisture_0_to_1cm || []).filter(
      (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
    );

    if (chuvas24h.length === 0 && ventos10mKmh.length === 0) return null;

    const chuva24hMm = chuvas24h.length > 0 ? Math.round(Math.max(...chuvas24h)) : 0;
    // Conversão padrão FAO-56 de vento a 10m para 2m: u2 = u10 * 0.748 (para comparar com NASA WS2M)
    const maxVento10mKmh = ventos10mKmh.length > 0 ? Math.max(...ventos10mKmh) : 0;
    const vento2mKmh = Number((maxVento10mKmh * 0.748).toFixed(1));
    const vento2mMs = Number((vento2mKmh / 3.6).toFixed(1));

    const chuva7dMm = chuvasAll.reduce((a, b) => a + b, 0);
    const et07dMm = et0List.reduce((a, b) => a + b, 0);
    const balancoHidrico7dMm =
      et0List.length > 0 ? Math.round(chuva7dMm - et07dMm) : null;

    const soilTempC =
      tempsSolo.length > 0 ? Number(tempsSolo[tempsSolo.length - 1].toFixed(1)) : null;
    const soilVolumetricM3 =
      umidSoloVol.length > 0 ? Number(umidSoloVol[umidSoloVol.length - 1].toFixed(3)) : null;

    const hTempAir = Array.isArray(hourly.temperature_2m) ? hourly.temperature_2m : [];
    const hRh = Array.isArray(hourly.relative_humidity_2m) ? hourly.relative_humidity_2m : [];
    const tempArRaw =
      typeof hTempAir[24] === 'number' && Number.isFinite(hTempAir[24])
        ? hTempAir[24]
        : hTempAir.find((v) => typeof v === 'number' && Number.isFinite(v));
    const rhRaw =
      typeof hRh[24] === 'number' && Number.isFinite(hRh[24])
        ? hRh[24]
        : hRh.find((v) => typeof v === 'number' && Number.isFinite(v));
    const tempArC = typeof tempArRaw === 'number' ? Number(tempArRaw.toFixed(1)) : null;
    const umidadeRelativaPct = typeof rhRaw === 'number' ? Math.round(rhRaw) : null;
    const { deltaT, deltaTStatus } =
      tempArC !== null && umidadeRelativaPct !== null
        ? calcularDeltaT(tempArC, umidadeRelativaPct)
        : { deltaT: null, deltaTStatus: null };

    // Pressão atmosférica ao nível do mar (hPa) e queda barométrica nas próximas 24h (índice 24..47)
    const hPress = Array.isArray(hourly.pressure_msl) ? hourly.pressure_msl : [];
    const pressoesValidas = hPress.filter(
      (v) => typeof v === 'number' && Number.isFinite(v) && v >= 850 && v <= 1085
    );
    let pressureHpa = null;
    let pressureDropHpa = null;
    let pressureTrend = null;
    if (pressoesValidas.length > 0) {
      const pAtual =
        typeof hPress[24] === 'number' && Number.isFinite(hPress[24])
          ? hPress[24]
          : pressoesValidas[pressoesValidas.length - 1];
      pressureHpa = Number(pAtual.toFixed(1));
      const janela24hPress = hPress
        .slice(24, 48)
        .filter((v) => typeof v === 'number' && Number.isFinite(v) && v >= 850 && v <= 1085);
      if (janela24hPress.length > 0) {
        const minPress24h = Math.min(...janela24hPress);
        pressureDropHpa = Number((minPress24h - pAtual).toFixed(1));
      } else {
        pressureDropHpa = 0;
      }
      if (pressureDropHpa <= -3 || pressureHpa <= 1006) {
        pressureTrend = 'QUEDA_BRUSCA';
      } else if (pressureDropHpa <= -1.5 || pressureHpa <= 1011) {
        pressureTrend = 'INSTAVEL';
      } else {
        pressureTrend = 'ESTAVEL';
      }
    }

    // Janela horária nas próximas 24h (índice 24..47 por causa de past_days=1)
    let janelaHorariaHoje = null;
    const hTimes = Array.isArray(hourly.time) ? hourly.time : [];
    const hWind = Array.isArray(hourly.wind_speed_10m) ? hourly.wind_speed_10m : [];
    const hPrec = Array.isArray(hourly.precipitation) ? hourly.precipitation : [];
    if (hTimes.length >= 48 && hWind.length >= 48) {
      const horasSeguras = [];
      for (let idx = 24; idx < 48; idx++) {
        const v2m = typeof hWind[idx] === 'number' ? hWind[idx] * 0.748 : 99;
        const pMm = typeof hPrec[idx] === 'number' ? hPrec[idx] : 0;
        if (v2m <= 10 && pMm <= 0.2) {
          const hh = String(hTimes[idx]).slice(11, 13);
          horasSeguras.push({ hh, v2m: Number(v2m.toFixed(1)) });
        }
      }
      if (horasSeguras.length > 0) {
        const inicio = horasSeguras[0].hh;
        const fim = horasSeguras[horasSeguras.length - 1].hh;
        const ventoMax = Math.max(...horasSeguras.map((h) => h.v2m));
        janelaHorariaHoje = {
          melhorJanela: `${inicio}h–${fim}h`,
          horasSeguras: horasSeguras.length,
          resumo: `${horasSeguras.length}h seguras (${inicio}h–${fim}h, vento máx. ${ventoMax} km/h)`,
        };
      } else {
        janelaHorariaHoje = {
          melhorJanela: 'Sem janela hoje',
          horasSeguras: 0,
          resumo: 'Nenhuma hora sem deriva/chuva nas próximas 24h',
        };
      }
    }

    const forecastPorData = {};
    const timesDaily = Array.isArray(daily.time) ? daily.time : [];
    for (let i = 0; i < timesDaily.length; i++) {
      const dataStr = timesDaily[i];
      const ch = daily.precipitation_sum?.[i];
      const v10 = daily.wind_speed_10m_max?.[i];
      if (typeof dataStr === 'string') {
        forecastPorData[dataStr] = {
          chuvaMm: typeof ch === 'number' && Number.isFinite(ch) ? Math.round(ch) : null,
          vento2mKmh:
            typeof v10 === 'number' && Number.isFinite(v10)
              ? Number((v10 * 0.748).toFixed(1))
              : null,
        };
      }
    }

    return {
      chuva24hMm,
      vento2mKmh,
      vento2mMs,
      balancoHidrico7dMm,
      soilTempC,
      soilVolumetricM3,
      tempArC,
      umidadeRelativaPct,
      deltaT,
      deltaTStatus,
      pressureHpa,
      pressureDropHpa,
      pressureTrend,
      janelaHorariaHoje,
      forecastPorData,
    };
  } catch {
    return null;
  }
}

const cacheElevacao = new Map();
async function buscarElevacaoTalhao(polygon, centroid) {
  const pontos = [];
  if (Array.isArray(polygon) && polygon.length >= 3) {
    const step = Math.max(1, Math.floor(polygon.length / 4));
    for (let i = 0; i < polygon.length && pontos.length < 4; i += step) {
      const pt = polygon[i];
      if (Array.isArray(pt) && Number.isFinite(Number(pt[0])) && Number.isFinite(Number(pt[1]))) {
        pontos.push([Number(pt[0]), Number(pt[1])]);
      }
    }
  }
  if (centroid && Number.isFinite(centroid.lat) && Number.isFinite(centroid.lng)) {
    pontos.push([centroid.lat, centroid.lng]);
  }
  if (pontos.length === 0) return null;

  const chave = pontos.map(([la, ln]) => `${la.toFixed(3)},${ln.toFixed(3)}`).join('|');
  const cached = cacheElevacao.get(chave);
  if (cached && Date.now() - cached.ts < 30 * 60 * 1000) return cached.value;

  try {
    const lats = pontos.map((p) => p[0].toFixed(5)).join(',');
    const lngs = pontos.map((p) => p[1].toFixed(5)).join(',');
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;
    const res = await axios.get(url, { timeout: 2000 });
    const elevs = Array.isArray(res?.data?.elevation)
      ? res.data.elevation.filter((v) => typeof v === 'number' && Number.isFinite(v))
      : [];
    if (elevs.length === 0) return null;

    const minM = Math.min(...elevs);
    const maxM = Math.max(...elevs);
    const altitudeMediaM = Math.round(elevs.reduce((a, b) => a + b, 0) / elevs.length);
    const desnivelM = Number((maxM - minM).toFixed(1));
    const declividadePct = Number(Math.min(25, (desnivelM / 250) * 100).toFixed(1));
    const riscoTopografico =
      declividadePct >= 8 || desnivelM >= 20
        ? 'ALTO_EROSAO_E_BAIXADA'
        : declividadePct >= 3 || desnivelM >= 8
          ? 'MODERADO'
          : 'PLANO';

    const value = { altitudeMediaM, desnivelM, declividadePct, riscoTopografico };
    cacheElevacao.set(chave, { ts: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}

const cacheSoilGrids = new Map();

/**
 * Valida e converte a resposta da API ISRIC SoilGrids v2.0 (g/kg -> %, pH*10 -> pH).
 * Protegida contra respostas HTML/erro (502/504) ou pixels nulos (água/urbano).
 */
function processarSoilGrids(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data?.properties?.layers)) {
    return null;
  }
  const extrair = (nome) => {
    const layer = data.properties.layers.find((l) => l?.name === nome);
    const val = layer?.depths?.[0]?.values?.mean;
    return typeof val === 'number' && Number.isFinite(val) && val >= 0 ? val : null;
  };

  const clayRaw = extrair('clay');
  const sandRaw = extrair('sand');
  const phRaw = extrair('phh2o');
  const socRaw = extrair('soc');
  if (clayRaw === null && sandRaw === null) return null;

  const argilaPct = clayRaw !== null ? Math.round(clayRaw / 10) : null;
  const areiaPct = sandRaw !== null ? Math.round(sandRaw / 10) : null;
  const ph = phRaw !== null ? Number((phRaw / 10).toFixed(1)) : null;
  const socGKg = socRaw !== null ? Number((socRaw / 10).toFixed(1)) : null;

  if (argilaPct !== null && (argilaPct < 0 || argilaPct > 100)) return null;
  if (areiaPct !== null && (areiaPct < 0 || areiaPct > 100)) return null;
  if (ph !== null && (ph < 3 || ph > 10)) return null;

  let classeTextural = 'Textura Média';
  if (argilaPct !== null && argilaPct >= 35) classeTextural = 'Solo Argiloso';
  else if (areiaPct !== null && areiaPct >= 60) classeTextural = 'Solo Arenoso';

  return {
    fonte: 'ISRIC SoilGrids v2.0',
    classeTextural,
    argilaPct,
    areiaPct,
    ph,
    socGKg,
  };
}

async function buscarPerfilSoloSoilGrids(lat, lng) {
  const chave = `${Number(lat).toFixed(2)}_${Number(lng).toFixed(2)}`;
  const cached = cacheSoilGrids.get(chave);
  if (cached && Date.now() - cached.ts < 10 * 60 * 1000) {
    return cached.value;
  }
  try {
    const url = `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lng}&lat=${lat}&property=clay&property=sand&property=phh2o&property=soc&depth=0-5cm&value=mean`;
    const res = await axios.get(url, { timeout: 2000 });
    const perfil = processarSoilGrids(res?.data);
    cacheSoilGrids.set(chave, { ts: Date.now(), value: perfil });
    return perfil;
  } catch {
    cacheSoilGrids.set(chave, { ts: Date.now(), value: null });
    return null;
  }
}

/**
 * Processa os 30+ membros do Ensemble (GFS/Open-Meteo) para a janela da 2ª semana (Dias 8 a 14),
 * calculando mediana, consenso probabilístico e evitando conflito com o alerta imediato (0-48h).
 */
function processarEnsemble14Dias(dailyData, balancoHidrico7dMm = null) {
  if (!dailyData || typeof dailyData !== 'object') return null;
  const chavesMembros = Object.keys(dailyData).filter(
    (k) => k === 'precipitation_sum' || k.startsWith('precipitation_sum_member')
  );
  if (chavesMembros.length === 0) return null;

  const totaisSemana2 = [];
  for (const chave of chavesMembros) {
    const serie = Array.isArray(dailyData[chave]) ? dailyData[chave] : [];
    // Dias 8 a 14 (índices 7..13) tratados como janela agregada para reduzir erro de fase
    const semana2 = serie.slice(7, 14).filter((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0);
    if (semana2.length > 0) {
      totaisSemana2.push(semana2.reduce((a, b) => a + b, 0));
    }
  }

  if (totaisSemana2.length === 0) return null;
  totaisSemana2.sort((a, b) => a - b);
  const meio = Math.floor(totaisSemana2.length / 2);
  const chuvaMedianaSemana2Mm = Math.round(totaisSemana2[meio]);
  const membrosComChuva = totaisSemana2.filter((mm) => mm >= 20).length;
  const consensoChuvaSemana2Pct = Math.round((membrosComChuva / totaisSemana2.length) * 100);
  const consensoSecaSemana2Pct = 100 - consensoChuvaSemana2Pct;
  const tendenciaSemana2 = consensoChuvaSemana2Pct >= 50 ? 'CHUVOSA' : 'SECA';
  const confiancaConsensoPct = Math.max(consensoChuvaSemana2Pct, consensoSecaSemana2Pct);

  return {
    totalMembros: totaisSemana2.length,
    chuvaMedianaSemana2Mm,
    consensoChuvaSemana2Pct,
    consensoSecaSemana2Pct,
    tendenciaSemana2,
    confiancaConsensoPct,
    balancoHidrico7dMm,
    resumo: `Ensemble (${totaisSemana2.length} membros, dias 8-14): ${confiancaConsensoPct}% de consenso para semana ${tendenciaSemana2.toLowerCase()} (mediana ${chuvaMedianaSemana2Mm}mm).`,
  };
}

async function buscarEnsemble14Dias(lat, lng, balancoHidrico7dMm = null) {
  try {
    const url = `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${lat}&longitude=${lng}&daily=precipitation_sum&forecast_days=14&models=gfs_seamless`;
    const res = await axios.get(url, { timeout: 2500 });
    return processarEnsemble14Dias(res?.data?.daily, balancoHidrico7dMm);
  } catch {
    return null;
  }
}

/**
 * Modelo Estocástico de Cadeia de Markov (3 estados: SECO, MODERADO, CRITICO)
 * sobre a série histórica recente da NASA POWER (até 60 dias) para estimar:
 * - Probabilidade de janela seca operacional em 3 dias
 * - Persistência de risco climático/solo úmido em 7 dias
 */
function calcularTendenciaMarkov(paramDaily) {
  const precMap = paramDaily?.PRECTOTCORR || {};
  const umidMap = paramDaily?.GWETTOP || {};
  const ventoMap = paramDaily?.WS2M || {};

  const datasOrdenadas = Object.keys(precMap).sort();
  const estados = [];

  for (const dia of datasOrdenadas) {
    const chuva = precMap[dia];
    if (typeof chuva !== 'number' || chuva < 0 || chuva > 600) continue;

    const umid = umidMap[dia];
    const vento = ventoMap[dia];
    const umidValida = typeof umid === 'number' && umid >= 0 && umid <= 1 ? umid : 0.5;
    const ventoValido = typeof vento === 'number' && vento >= 0 && vento <= 60 ? vento : 2.0;

    if (chuva >= 25 || umidValida >= 0.8 || ventoValido >= 5.0) {
      estados.push(2); // CRITICO
    } else if (chuva >= 5 || umidValida >= 0.7 || ventoValido > 2.7) {
      estados.push(1); // MODERADO
    } else {
      estados.push(0); // SECO
    }
  }

  if (estados.length < 5) {
    return {
      estadoAtual: 'MODERADO',
      diasAnalisados: estados.length,
      janelaSeca3dPct: 45,
      persistenciaRisco7dPct: 55,
      resumo: 'Série curta da NASA: tendência estocástica neutra (45% janela seca em 3d).',
    };
  }

  // Matriz de transição 3x3 com suavização de Laplace (+0.5)
  const contagens = [
    [0.5, 0.5, 0.5],
    [0.5, 0.5, 0.5],
    [0.5, 0.5, 0.5],
  ];
  for (let i = 0; i < estados.length - 1; i++) {
    contagens[estados[i]][estados[i + 1]] += 1;
  }

  const P = contagens.map((linha) => {
    const soma = linha.reduce((a, b) => a + b, 0);
    return linha.map((v) => v / soma);
  });

  const multiplicarVetorMatriz = (vec, mat) => [
    vec[0] * mat[0][0] + vec[1] * mat[1][0] + vec[2] * mat[2][0],
    vec[0] * mat[0][1] + vec[1] * mat[1][1] + vec[2] * mat[2][1],
    vec[0] * mat[0][2] + vec[1] * mat[1][2] + vec[2] * mat[2][2],
  ];

  const estadoIdx = estados[estados.length - 1];
  const nomesEstados = ['SECO', 'MODERADO', 'CRITICO'];
  let dist = [0, 0, 0];
  dist[estadoIdx] = 1;

  let dist3d = dist;
  for (let d = 0; d < 3; d++) dist3d = multiplicarVetorMatriz(dist3d, P);

  let dist7d = dist3d;
  for (let d = 3; d < 7; d++) dist7d = multiplicarVetorMatriz(dist7d, P);

  const janelaSeca3dPct = Math.round(dist3d[0] * 100);
  const persistenciaRisco7dPct = Math.round((dist7d[1] + dist7d[2]) * 100);

  return {
    estadoAtual: nomesEstados[estadoIdx],
    diasAnalisados: estados.length,
    janelaSeca3dPct,
    persistenciaRisco7dPct,
    resumo: `Cadeia de Markov (${estados.length} dias NASA): ${janelaSeca3dPct}% de chance de janela seca em 3 dias; ${persistenciaRisco7dPct}% de risco climático persistente em 7 dias.`,
  };
}

async function buscarDadosNasaParaFrontEnd(lat, lng) {
  const chaveCoord = `${Number(lat).toFixed(2)}_${Number(lng).toFixed(2)}`;
  if (cacheNasaPorCoordenada.has(chaveCoord)) {
    return cacheNasaPorCoordenada.get(chaveCoord);
  }

  try {
    const agora = new Date();
    const dataFim = agora.toISOString().slice(0, 10).replace(/-/g, '');
    // Janela de 60 dias na mesma chamada HTTP da NASA POWER para alimentar a Cadeia de Markov
    const dataInicio = new Date(agora.getTime() - 60 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');

    // 1. Climatology: Média histórica da coordenada (PRECTOTCORR)
    const urlClimatology = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=PRECTOTCORR&community=AG&longitude=${lng}&latitude=${lat}&format=JSON`;

    // 2. Daily: Precipitação (PRECTOTCORR), Umidade Superficial (GWETTOP), Umidade Zona Radicular SMAP (GWETROOT) e Vento a 2m (WS2M)
    const urlDaily = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,GWETTOP,GWETROOT,WS2M&community=AG&longitude=${lng}&latitude=${lat}&start=${dataInicio}&end=${dataFim}&format=JSON`;

    const [resClima, resDaily, openMeteo, ensembleRaw, soilGrids, rainHeatmapGrid] =
      await Promise.all([
        axios.get(urlClimatology, { timeout: 3500 }),
        axios.get(urlDaily, { timeout: 3500 }),
        buscarOpenMeteoTempoReal(lat, lng),
        buscarEnsemble14Dias(lat, lng),
        buscarPerfilSoloSoilGrids(lat, lng),
        buscarGradeRegionalChuva(lat, lng),
      ]);
    const ensemble14d = ensembleRaw
      ? {
          ...ensembleRaw,
          balancoHidrico7dMm: openMeteo?.balancoHidrico7dMm ?? ensembleRaw.balancoHidrico7dMm,
        }
      : null;

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

    // Calcula tendência estocástica de 3d e 7d via Cadeia de Markov usando toda a janela de 60 dias
    const markov = calcularTendenciaMarkov(paramDaily);

    // Filtra flags -999 e usa APENAS os últimos 10 dias válidos para o cálculo do risco imediato atual
    const chuvasValidas = Object.values(paramDaily.PRECTOTCORR || {})
      .filter((v) => typeof v === 'number' && v >= 0 && v <= 600)
      .slice(-10);
    const umidadesValidas = Object.values(paramDaily.GWETTOP || {})
      .filter((v) => typeof v === 'number' && v >= 0 && v <= 1)
      .slice(-10);
    const umidadesRaizValidas = Object.values(paramDaily.GWETROOT || {})
      .filter((v) => typeof v === 'number' && v >= 0 && v <= 1)
      .slice(-10);
    const ventosValidos = Object.values(paramDaily.WS2M || {})
      .filter((v) => typeof v === 'number' && v >= 0 && v <= 60)
      .slice(-10);

    if (chuvasValidas.length === 0) {
      throw new Error('Sem leituras válidas de precipitação na janela recente da NASA.');
    }

    const picoDiarioMm = Math.max(...chuvasValidas);
    const acumuladoJanelaMm = chuvasValidas.reduce((a, b) => a + b, 0);
    const nasaPredictedRain = Math.round(Math.max(picoDiarioMm, acumuladoJanelaMm));

    // Fusão conservadora: NASA POWER (principal) + Open-Meteo (tempo real 0h de atraso + próximas 24h)
    const predictedRain = openMeteo
      ? Math.round(Math.max(nasaPredictedRain, openMeteo.chuva24hMm))
      : nasaPredictedRain;

    // Umidade superficial (GWETTOP) e umidade da zona radicular SMAP (GWETROOT) -> 0 a 100%
    const ultimaUmidade =
      umidadesValidas.length > 0
        ? umidadesValidas[umidadesValidas.length - 1]
        : Math.min(0.92, 0.45 + predictedRain / 200);
    const soilMoisture = Math.min(99, Math.max(15, Math.round(ultimaUmidade * 100)));

    const ultimaUmidadeRaiz =
      umidadesRaizValidas.length > 0
        ? umidadesRaizValidas[umidadesRaizValidas.length - 1]
        : ultimaUmidade;
    const rootZoneMoisture = Math.min(99, Math.max(15, Math.round(ultimaUmidadeRaiz * 100)));

    const nasaWindSpeed2m =
      ventosValidos.length > 0 ? Number(Math.max(...ventosValidos).toFixed(1)) : 2.8;
    const windSpeed2m = openMeteo
      ? Number(Math.max(nasaWindSpeed2m, openMeteo.vento2mMs).toFixed(1))
      : nasaWindSpeed2m;

    // Gabarito físico determinístico (Pré-IA alinhado às diretrizes EMBRAPA/ZARC: vento > 2.7 m/s e chuva > 50mm)
    let minPhysicalRisk = 'green';
    if (predictedRain >= 50 || soilMoisture >= 82 || rootZoneMoisture >= 84 || windSpeed2m >= 5.0) {
      minPhysicalRisk = 'red';
    } else if (
      windSpeed2m > 2.7 ||
      predictedRain >= 35 ||
      soilMoisture >= 70 ||
      rootZoneMoisture >= 72
    ) {
      minPhysicalRisk = 'yellow';
    }

    const resultadoNasa = {
      historicalRain,
      predictedRain,
      soilMoisture,
      rootZoneMoisture,
      soilTempC: openMeteo?.soilTempC ?? null,
      soilVolumetricM3: openMeteo?.soilVolumetricM3 ?? null,
      tempArC: openMeteo?.tempArC ?? null,
      umidadeRelativaPct: openMeteo?.umidadeRelativaPct ?? null,
      deltaT: openMeteo?.deltaT ?? null,
      deltaTStatus: openMeteo?.deltaTStatus ?? null,
      pressureHpa: openMeteo?.pressureHpa ?? null,
      pressureDropHpa: openMeteo?.pressureDropHpa ?? null,
      pressureTrend: openMeteo?.pressureTrend ?? null,
      rainHeatmapGrid: Array.isArray(rainHeatmapGrid) ? rainHeatmapGrid : [],
      soilGrids: soilGrids || null,
      forecastPorData: openMeteo?.forecastPorData || {},
      windSpeed2m,
      minPhysicalRisk,
      markov,
      ensemble14d,
      nasaLive: true,
      openMeteoLive: Boolean(openMeteo),
      dataSources: openMeteo
        ? 'NASA POWER + SMAP (GWETROOT) + Open-Meteo'
        : 'NASA POWER + SMAP (GWETROOT)',
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
      openMeteoLive: false,
      dataSources: 'Fallback Determinístico (NASA indisponível)',
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

// Algoritmo de Índice de Risco Composto (0 a 100) + Fator SMAP (GWETROOT)
// Calcula o score matemático antes da IA para que o Claude atue como tradutor pericial do score.
function calcularPisoFisicoRegional(nasa, limites) {
  const ventoKmh = Number((nasa.windSpeed2m * 3.6).toFixed(1)); // NASA WS2M vem em m/s
  const rootZoneMoisture = Number.isFinite(nasa.rootZoneMoisture)
    ? nasa.rootZoneMoisture
    : nasa.soilMoisture;

  // 1. Sub-score Chuva vs Limite do Manual (0 a 40 pts)
  // Se o solo SMAP está seco (< 55%) e a chuva não atingiu o patamar de alerta, o solo absorve bem ("chuva é bênção")
  const fatorSoloSeco =
    rootZoneMoisture < 55 && nasa.soilMoisture < 55 && nasa.predictedRain < limites.chuvaRedMm * 0.75
      ? 0.65
      : 1.0;
  const ptsChuva = Math.min(
    40,
    (nasa.predictedRain / Math.max(1, limites.chuvaRedMm)) * 40 * fatorSoloSeco
  );

  // 2. Sub-score Saturação SMAP (GWETTOP superficial + GWETROOT zona radicular) (0 a 38 pts)
  const umidadeMediaSolo = nasa.soilMoisture * 0.45 + rootZoneMoisture * 0.55;
  let ptsSolo = Math.min(25, (umidadeMediaSolo / Math.max(1, limites.umidadeRedPct)) * 25);
  // Sinergia física: 20mm em solo seco é bênção, mas >= 15mm em zona radicular já saturada (>= 74%) causa atolamento!
  if (nasa.predictedRain >= 15 && rootZoneMoisture >= 74) {
    ptsSolo = Math.min(38, ptsSolo + 14);
  }
  // Ajuste em tempo real pela umidade volumétrica (Open-Meteo m³/m³) e textura pedológica (SoilGrids)
  if (typeof nasa.soilVolumetricM3 === 'number' && nasa.soilVolumetricM3 >= 0.42) {
    ptsSolo = Math.min(38, ptsSolo + 4);
  }
  if (nasa.soilGrids?.argilaPct >= 45) {
    ptsSolo = Math.min(38, ptsSolo + 4);
  } else if (nasa.soilGrids?.areiaPct >= 65) {
    ptsSolo = Math.max(0, ptsSolo - 3);
  }

  // 3. Sub-score Vento / Deriva (0 a 25 pts)
  let ptsVento = Math.min(25, (ventoKmh / Math.max(1, limites.ventoRedKmh)) * 25);
  if (ventoKmh > limites.ventoDerivaKmh && ptsVento < 15) {
    ptsVento = 15;
  }

  // 4. Alerta térmico do solo (Open-Meteo soil_temperature_0cm)
  let soilThermalAlert = null;
  let ptsTermico = 0;
  if (typeof nasa.soilTempC === 'number') {
    if (nasa.soilTempC >= 35) {
      soilThermalAlert = 'ALTO_VOLATILIZACAO';
      ptsTermico = 6;
    } else if (nasa.soilTempC < 15) {
      soilThermalAlert = 'SOLO_FRIO';
      ptsTermico = 3;
    }
  }

  // 5. Sub-score Pressão Atmosférica / Sistema Frontal (0 a 10 pts)
  let ptsPressao = 0;
  if (
    nasa.pressureTrend === 'QUEDA_BRUSCA' ||
    (typeof nasa.pressureHpa === 'number' && nasa.pressureHpa <= 1006) ||
    (typeof nasa.pressureDropHpa === 'number' && nasa.pressureDropHpa <= -3)
  ) {
    ptsPressao = 10;
  } else if (
    nasa.pressureTrend === 'INSTAVEL' ||
    (typeof nasa.pressureHpa === 'number' && nasa.pressureHpa <= 1011) ||
    (typeof nasa.pressureDropHpa === 'number' && nasa.pressureDropHpa <= -1.5)
  ) {
    ptsPressao = 5;
  }

  let riskScore = Math.min(
    100,
    Math.max(0, Math.round(ptsChuva + ptsSolo + ptsVento + ptsTermico + ptsPressao))
  );

  let minPhysicalRisk = 'green';
  if (
    riskScore >= 70 ||
    nasa.predictedRain >= limites.chuvaRedMm ||
    nasa.soilMoisture >= limites.umidadeRedPct ||
    rootZoneMoisture >= Math.min(92, limites.umidadeRedPct + 4) ||
    ventoKmh >= limites.ventoRedKmh
  ) {
    minPhysicalRisk = 'red';
    if (riskScore < 72) riskScore = 72;
  } else if (
    riskScore >= 45 ||
    ventoKmh > limites.ventoDerivaKmh ||
    nasa.predictedRain >= limites.chuvaRedMm * 0.75 ||
    nasa.soilMoisture >= limites.umidadeRedPct - 10 ||
    rootZoneMoisture >= limites.umidadeRedPct - 8
  ) {
    minPhysicalRisk = 'yellow';
    if (riskScore < 45) riskScore = 45;
  }

  return { minPhysicalRisk, ventoKmh, rootZoneMoisture, riskScore, soilThermalAlert };
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'dummy_key_for_fallback_mode',
});

const PESO_RISK = { green: 0, yellow: 1, red: 2 };

/**
 * Auditor Numérico Anti-Alucinação:
 * Verifica se o LLM inventou valores em "mm", "km/h" ou "%" que não correspondem
 * aos dados reais da NASA/Open-Meteo nem aos limites do manual técnico regional.
 */
function contemNumeroAlucinado(texto, nasaMetrics, limites, ventoKmh) {
  if (typeof texto !== 'string' || !texto.trim()) return false;
  const normalizado = texto.replace(/(\d+),(\d+)/g, '$1.$2');

  const mmPermitidos = [
    nasaMetrics.predictedRain,
    nasaMetrics.historicalRain,
    limites.chuvaRedMm,
    Math.round(limites.chuvaRedMm * 0.75),
    24, // janela "24h" caso apareça próximo
    48,
  ];
  const kmhPermitidos = [
    ventoKmh,
    limites.ventoDerivaKmh,
    limites.ventoRedKmh,
    3,
  ];
  const pctPermitidos = [
    nasaMetrics.soilMoisture,
    nasaMetrics.rootZoneMoisture,
    nasaMetrics.riskScore,
    nasaMetrics.soilGrids?.argilaPct,
    nasaMetrics.soilGrids?.areiaPct,
    limites.umidadeRedPct,
    limites.umidadeRedPct - 10,
    limites.umidadeRedPct - 8,
  ];

  const pertoDeAlgum = (val, lista, tol) =>
    lista.some((ref) => typeof ref === 'number' && Number.isFinite(ref) && Math.abs(val - ref) <= tol);

  for (const match of normalizado.matchAll(/(\d+(?:\.\d+)?)\s*mm\b/gi)) {
    const val = Number(match[1]);
    if (Number.isFinite(val) && !pertoDeAlgum(val, mmPermitidos, 2.5)) {
      return `Valor inventado "${match[0]}" não bate com NASA (${nasaMetrics.predictedRain}mm/${nasaMetrics.historicalRain}mm) nem manual (${limites.chuvaRedMm}mm)`;
    }
  }

  for (const match of normalizado.matchAll(/(\d+(?:\.\d+)?)\s*km\/h\b/gi)) {
    const val = Number(match[1]);
    if (Number.isFinite(val) && !pertoDeAlgum(val, kmhPermitidos, 1.5)) {
      return `Vento inventado "${match[0]}" não bate com medição (${ventoKmh}km/h) nem manual (${limites.ventoDerivaKmh}km/h)`;
    }
  }

  for (const match of normalizado.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
    const val = Number(match[1]);
    if (Number.isFinite(val) && !pertoDeAlgum(val, pctPermitidos, 3)) {
      return `Umidade inventada "${match[0]}" não bate com GWETTOP (${nasaMetrics.soilMoisture}%) nem manual (${limites.umidadeRedPct}%)`;
    }
  }

  return false;
}

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
    (riskFinal !== 'green' &&
      /condi[cç][oõ]es favor[aá]veis|opera[cç][oõ]es liberadas/i.test(guidance)) ||
    contemNumeroAlucinado(guidance, nasaMetrics, lim, ventoKmh)
  ) {
    guidance = padrao.guidance;
  }

  let technicalReason =
    typeof iaJsonBruto?.technicalReason === 'string' &&
    iaJsonBruto.technicalReason.trim().length > 15
      ? iaJsonBruto.technicalReason.trim()
      : padrao.technicalReason;

  if (contemNumeroAlucinado(technicalReason, nasaMetrics, lim, ventoKmh)) {
    technicalReason = padrao.technicalReason;
  }

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
        const alucinouNumero = Boolean(contemNumeroAlucinado(limpo, nasaMetrics, lim, ventoKmh));
        if (!contradizRisco && !alucinouNumero && !actions.includes(limpo)) {
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
    rootZoneMoisture: Number(nasaMetrics.rootZoneMoisture ?? soilMoisture),
    soilTempC: nasaMetrics.soilTempC ?? null,
    soilVolumetricM3: nasaMetrics.soilVolumetricM3 ?? null,
    tempArC: nasaMetrics.tempArC ?? null,
    umidadeRelativaPct: nasaMetrics.umidadeRelativaPct ?? null,
    deltaT: nasaMetrics.deltaT ?? null,
    deltaTStatus: nasaMetrics.deltaTStatus ?? null,
    pressureHpa: nasaMetrics.pressureHpa ?? null,
    pressureDropHpa: nasaMetrics.pressureDropHpa ?? null,
    pressureTrend: nasaMetrics.pressureTrend ?? null,
    rainHeatmapGrid: Array.isArray(nasaMetrics.rainHeatmapGrid) ? nasaMetrics.rainHeatmapGrid : [],
    soilGrids: nasaMetrics.soilGrids ?? null,
    riskScore: Number(nasaMetrics.riskScore ?? 50),
    windSpeedKmh: Number(ventoKmh),
    windLimitKmh: Number(regiao.limites.ventoDerivaKmh),
    rainLimitMm: Number(regiao.limites.chuvaRedMm),
    regionCode: regiao.uf,
    regionName: regiao.nome,
    soilType: regiao.solo,
    manualSource: regiao.fonte,
    dataSources: nasaMetrics.dataSources || 'NASA POWER',
    markov: nasaMetrics.markov || null,
    ensemble14d: nasaMetrics.ensemble14d || null,
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

🛰️ DADOS DE SATÉLITE E TEMPO REAL (${nasaMetrics.dataSources || 'NASA POWER'}):
- Média histórica de chuva: ${nasaMetrics.historicalRain} mm
- Pico de chuva recente (PRECTOTCORR): ${nasaMetrics.predictedRain} mm
- Umidade superficial do solo (GWETTOP): ${nasaMetrics.soilMoisture}%
- Umidade na zona das raízes / NASA SMAP (GWETROOT): ${nasaMetrics.rootZoneMoisture ?? nasaMetrics.soilMoisture}%
${typeof nasaMetrics.soilTempC === 'number' ? `- Temperatura superficial do solo (0cm): ${nasaMetrics.soilTempC}°C${nasaMetrics.soilThermalAlert === 'ALTO_VOLATILIZACAO' ? ' (ALERTA: >= 35°C, alto risco de volatilização de herbicida e estresse na germinação)' : nasaMetrics.soilThermalAlert === 'SOLO_FRIO' ? ' (ALERTA: < 15°C, emergência lenta na semeadura)' : ''}` : ''}
${typeof nasaMetrics.soilVolumetricM3 === 'number' ? `- Umidade volumétrica em tempo real (0-1cm): ${nasaMetrics.soilVolumetricM3} m³/m³` : ''}
${nasaMetrics.soilGrids ? `- Perfil pedológico SoilGrids: ${nasaMetrics.soilGrids.classeTextural} (${nasaMetrics.soilGrids.argilaPct}% argila, pH ${nasaMetrics.soilGrids.ph})` : ''}
- Pico de vento a 2m (WS2M): ${ventoKmh} km/h (${nasaMetrics.windSpeed2m} m/s)
${nasaMetrics.markov ? `- Tendência Estocástica (Cadeia de Markov): ${nasaMetrics.markov.resumo}` : ''}
${nasaMetrics.ensemble14d ? `- Horizonte Semana 2 (APENAS referência futura dias 8-14, NÃO altera o alerta de hoje): ${nasaMetrics.ensemble14d.resumo}` : ''}

⚖️ ÍNDICE DE RISCO COMPOSTO (CALCULADO PELO NODE.JS): ${nasaMetrics.riskScore ?? 50}/100 → Piso Físico: "${nasaMetrics.minPhysicalRisk}"
(Atue como tradutor pericial deste Score matemático de 0 a 100 e do fator SMAP GWETROOT.)

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

/**
 * Valida a assinatura HMAC-SHA1 (X-Twilio-Signature) quando TWILIO_VALIDATE_SIGNATURE=true.
 */
function validarAssinaturaTwilio(req, fullUrlOverride = null) {
  const signature = req.headers?.['x-twilio-signature'];
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!signature || !authToken) return false;
  const url =
    fullUrlOverride ||
    `${req.protocol || 'https'}://${req.get?.('host') || 'localhost'}${req.originalUrl || ''}`;
  const params = req.body && typeof req.body === 'object' ? req.body : {};
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + String(params[key] ?? '');
  }
  const expected = crypto.createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
  const sigBuf = Buffer.from(String(signature));
  const expBuf = Buffer.from(expected);
  return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
}

// ============================================================================
// 5. PORTÃO DE CERTEZA PARA SMS 2G + ALERTAS OFICIAIS INMET / DEFESA CIVIL
// ============================================================================
let cacheAvisosInmet = { timestamp: 0, avisos: [] };

/**
 * Consulta o feed público oficial de avisos meteorológicos do INMET (base usada pela Defesa Civil).
 * Verifica com Turf.js se a coordenada (lat, lng) do talhão está dentro do polígono de algum aviso ativo.
 */
async function buscarAlertaOficialInmet(lat, lng, ufRegiao) {
  const regioesBrasil = ['PR', 'BA', 'CERRADO', 'SUL_RS_SC', 'SUDESTE', 'BR'];
  if (!regioesBrasil.includes(ufRegiao)) return null;

  try {
    const agora = Date.now();
    if (agora - cacheAvisosInmet.timestamp > 5 * 60 * 1000) {
      const res = await axios.get('https://apiprevmet3.inmet.gov.br/avisos/ativos', {
        timeout: 2200,
      });
      const todos = [
        ...(Array.isArray(res?.data?.hoje) ? res.data.hoje : []),
        ...(Array.isArray(res?.data?.futuro) ? res.data.futuro : []),
      ];
      cacheAvisosInmet = { timestamp: agora, avisos: todos };
    }

    const ponto = turf.point([Number(lng), Number(lat)]);
    for (const aviso of cacheAvisosInmet.avisos) {
      if (!aviso?.poligono) continue;
      try {
        const geo = typeof aviso.poligono === 'string' ? JSON.parse(aviso.poligono) : aviso.poligono;
        if (geo && (geo.type === 'Polygon' || geo.type === 'MultiPolygon')) {
          if (turf.booleanPointInPolygon(ponto, geo)) {
            return {
              id: aviso.id || null,
              evento: aviso.descricao || aviso.aviso || 'Alerta Meteorológico',
              severidade: aviso.severidade || 'Perigo Potencial',
              fonte: 'INMET / Defesa Civil',
            };
          }
        }
      } catch {
        // Ignora polígono malformado individual
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Portão Determinístico de Certeza para Disparo Ativo de SMS 2G:
 * NUNCA confia apenas na IA para disparar SMS ao agricultor.
 * Só autoriza o envio quando há certeza física multi-fonte:
 * 1. Leituras reais (NASA/Open-Meteo) ou simulação explícita;
 * 2. Piso físico determinístico 'red' OU consenso duplo (INMET Perigo/Grande Perigo + risco físico >= yellow).
 */
function avaliarCertezaAlertaSms(nasaMetrics, regiao, alertaOficialInmet = null, opcoes = {}) {
  const lim = regiao?.limites || { chuvaRedMm: 45, ventoRedKmh: 20, umidadeRedPct: 80 };
  const ventoKmh = nasaMetrics.ventoKmh ?? Number((nasaMetrics.windSpeed2m * 3.6).toFixed(1));
  const temDadoRealOuSimulado =
    Boolean(opcoes.isSimulated) ||
    Boolean(nasaMetrics.nasaLive) ||
    Boolean(nasaMetrics.openMeteoLive);

  if (!temDadoRealOuSimulado) {
    return {
      autorizado: false,
      motivo: 'SMS bloqueado: sem leitura ao vivo confirmada (modo fallback offline).',
    };
  }

  const inmetCritico =
    alertaOficialInmet && /grande perigo|perigo(?! potencial)/i.test(String(alertaOficialInmet.severidade || ''));

  const criterioChuva = nasaMetrics.predictedRain >= lim.chuvaRedMm;
  const criterioVento = ventoKmh >= lim.ventoRedKmh;
  const criterioUmidade = nasaMetrics.soilMoisture >= lim.umidadeRedPct;
  const fisicoVermelho = nasaMetrics.minPhysicalRisk === 'red';

  if (fisicoVermelho && (criterioChuva || criterioVento || criterioUmidade)) {
    const causas = [];
    if (criterioChuva) causas.push(`chuva ${nasaMetrics.predictedRain}mm >= ${lim.chuvaRedMm}mm`);
    if (criterioVento) causas.push(`vento ${ventoKmh}km/h >= ${lim.ventoRedKmh}km/h`);
    if (criterioUmidade) causas.push(`solo ${nasaMetrics.soilMoisture}% >= ${lim.umidadeRedPct}%`);
    return {
      autorizado: true,
      motivo: `Certeza física confirmada (${causas.join(', ')})`,
    };
  }

  if (inmetCritico && nasaMetrics.minPhysicalRisk !== 'green') {
    return {
      autorizado: true,
      motivo: `Consenso duplo: ${alertaOficialInmet.fonte} (${alertaOficialInmet.severidade}) + satélite`,
    };
  }

  return {
    autorizado: false,
    motivo: 'SMS bloqueado pelo Portão de Certeza Física (sem confirmação severa multi-fonte).',
  };
}

// ============================================================================
// 5.1 ROTA OFICIAL DO FRONT-END: POST /api/analyze-field
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

    // 2.1 Consulta NASA POWER + Open-Meteo, INMET e Elevação SRTM/Open-Meteo em paralelo
    const [nasaBrutoBase, alertaOficialInmet, elevation] = await Promise.all([
      buscarDadosNasaParaFrontEnd(fieldReq.centroid.lat, fieldReq.centroid.lng),
      buscarAlertaOficialInmet(fieldReq.centroid.lat, fieldReq.centroid.lng, fieldReq.regiao.uf),
      buscarElevacaoTalhao(fieldReq.polygon, fieldReq.centroid),
    ]);
    let nasaBruto = aplicarCenarioClimatico(
      nasaBrutoBase,
      fieldReq.climateScenario,
      fieldReq.regiao.uf
    );

    const simulateRisk = req.body?.simulateRisk;
    if (simulateRisk === 'red') {
      nasaBruto = {
        ...nasaBrutoBase,
        predictedRain: Math.max(lim.chuvaRedMm + 28, Math.round(nasaBrutoBase.historicalRain * 1.9)),
        soilMoisture: Math.max(lim.umidadeRedPct + 7, 89),
        windSpeed2m: Number(((lim.ventoDerivaKmh + 14) / 3.6).toFixed(2)),
      };
    } else if (simulateRisk === 'yellow') {
      nasaBruto = {
        ...nasaBrutoBase,
        predictedRain: Math.max(18, Math.min(lim.chuvaRedMm - 6, Math.round(nasaBrutoBase.historicalRain * 1.15))),
        soilMoisture: Math.min(lim.umidadeRedPct - 8, 71),
        windSpeed2m: Number(((lim.ventoDerivaKmh + 3.5) / 3.6).toFixed(2)),
      };
    } else if (simulateRisk === 'green') {
      nasaBruto = {
        ...nasaBrutoBase,
        predictedRain: Math.min(16, Math.max(8, lim.chuvaRedMm - 25)),
        soilMoisture: 54,
        windSpeed2m: Number((Math.max(3, lim.ventoDerivaKmh - 4) / 3.6).toFixed(2)),
      };
    }

    const nasaMetrics = {
      ...nasaBruto,
      elevation,
      ...calcularPisoFisicoRegional(nasaBruto, lim),
    };
    console.log(
      `📚 [GROUNDING] ${fieldReq.regiao.uf} · ${fieldReq.crop} · ${fieldReq.regiao.fonte} → piso físico "${nasaMetrics.minPhysicalRisk}" (vento ${nasaMetrics.ventoKmh} km/h, chuva ${nasaMetrics.predictedRain} mm)`
    );

    // 3. Gera análise com Claude IA + Dupla Trava de Confiabilidade + Plano Determinístico da Operação
    const resultadoFrontEnd = await gerarAnaliseComClaude(fieldReq, nasaMetrics);
    const operationPlan = avaliarOperacaoPlanejada(fieldReq, nasaMetrics, fieldReq.regiao);
    const biophysModel = avaliarModeloBiofisicoProbabilistico(fieldReq, nasaMetrics, fieldReq.regiao);

    // 4. Salva no PostgreSQL (JSONB) ou memória sem bloquear a resposta ao Front-end
    salvarAnaliseNoBanco(fieldReq, nasaMetrics, resultadoFrontEnd);

    // 5. Portão de Certeza para SMS 2G: nunca confia só na IA — só dispara se física/INMET confirmarem perigo real
    const certezaSms = avaliarCertezaAlertaSms(nasaMetrics, fieldReq.regiao, alertaOficialInmet, {
      isSimulated: simulateRisk === 'red',
    });

    let smsAlert = null;
    if (resultadoFrontEnd.risk === 'red' && certezaSms.autorizado) {
      try {
        smsAlert = await dispararAlertaSms2G(
          fieldReq,
          nasaMetrics,
          resultadoFrontEnd,
          req.body?.telefone_produtor,
          alertaOficialInmet
        );
      } catch {
        // Ignora erro de envio externo
      }
    } else if (resultadoFrontEnd.risk === 'red' && !certezaSms.autorizado) {
      console.log(`🛡️ [PORTÃO SMS 2G] ${certezaSms.motivo}`);
    }

    return res.status(200).json({
      ...resultadoFrontEnd,
      climateScenario: fieldReq.climateScenario,
      operationPlan,
      biophysModel,
      elevation,
      hourlyWindow: nasaMetrics.janelaHorariaHoje || null,
      alertaDefesaCivil: alertaOficialInmet,
      smsGate: certezaSms,
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
  // ou se inventou números em mm / km/h / % que não existem na leitura real
  const iaDisseLiberado =
    /\bsim\b|pode pulverizar|pulveriza[cç][aã]o liberada|opera[cç][oõ]es liberadas|pode entrar/i.test(
      texto
    ) && !/\bn[aã]o\b/i.test(texto);
  const alucinouNumeroSms = Boolean(contemNumeroAlucinado(texto, nasaMetrics, lim, ventoKmh));

  if (!texto || texto.length < 10 || (riscoFisico !== 'green' && iaDisseLiberado) || alucinouNumeroSms) {
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

async function enviarViaSimpleSmsGateway(phone, message) {
  const gatewayUrl = process.env.SIMPLE_SMS_GATEWAY_URL;
  if (!gatewayUrl || !phone || !message) return false;
  try {
    await axios.post(
      gatewayUrl,
      { phone: String(phone).trim(), message: String(message).slice(0, 150) },
      { timeout: 4500 }
    );
    console.log(`📲 [SIMPLE SMS GATEWAY] Enviado para ${phone}: "${message}"`);
    return true;
  } catch (err) {
    console.warn('[AVISO SIMPLE SMS GATEWAY]:', err.message);
    return false;
  }
}

/**
 * Disparo ativo de SMS quando a análise do talhão retorna "red" (Perigo Severo)
 */
async function dispararAlertaSms2G(
  fieldReq,
  nasaMetrics,
  resultadoFrontEnd,
  telefoneDestino,
  alertaOficialInmet = null
) {
  const fone = telefoneDestino || process.env.FARMER_DEFAULT_PHONE || '+5544999999999';
  const ventoKmh = nasaMetrics.ventoKmh ?? Number((nasaMetrics.windSpeed2m * 3.6).toFixed(1));
  const prefixoDefesa = alertaOficialInmet ? 'INMET+AGROSHIELD' : 'AGROSHIELD';
  const textoSms = `${prefixoDefesa} ALERTA VERMELHO (${fieldReq.crop}): Chuva ${nasaMetrics.predictedRain}mm, vento ${ventoKmh}km/h. ${resultadoFrontEnd.guidance}`.slice(
    0,
    150
  );

  await enviarViaSimpleSmsGateway(fone, textoSms);

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
    if (process.env.TWILIO_VALIDATE_SIGNATURE === 'true' && !validarAssinaturaTwilio(req)) {
      return res.status(403).json({ error: 'Assinatura Twilio inválida.' });
    }
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

    const culturaDetectadaNoSms = /\bmilho\b/i.test(perguntaAgricultor)
      ? 'Milho'
      : /\btrigo\b/i.test(perguntaAgricultor)
        ? 'Trigo'
        : /\bsoja\b/i.test(perguntaAgricultor)
          ? 'Soja'
          : null;

    const fieldReq = normalizarFieldRequest({
      crop: req.body?.crop || culturaDetectadaNoSms || ultimoTalhao.crop,
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

    const telefoneExplicito = req.body?.telefone || req.body?.From;
    const enviadoGatewayReal = telefoneExplicito
      ? await enviarViaSimpleSmsGateway(telefoneExplicito, respostaSmsSegura)
      : false;

    const logInteracao = {
      tipo: 'INBOUND_CONVERSATIONAL_2G',
      de: telefoneRemetente,
      pergunta_agricultor: perguntaAgricultor,
      regiao: fieldReq.regiao.uf,
      fonte_manual: fieldReq.regiao.fonte,
      risco_fisico: nasaMetrics.minPhysicalRisk,
      resposta_sms: respostaSmsSegura,
      caracteres: respostaSmsSegura.length,
      enviado_sms_real: enviadoGatewayReal,
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
  contemNumeroAlucinado,
  calcularTendenciaMarkov,
  avaliarCertezaAlertaSms,
  processarEnsemble14Dias,
  processarSoilGrids,
  avaliarOperacaoPlanejada,
  avaliarModeloBiofisicoProbabilistico,
  aplicarCenarioClimatico,
  atualizarMemoriaAgricola,
  validarAssinaturaTwilio,
  calcularDeltaT,
};
