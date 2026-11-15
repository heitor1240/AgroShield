import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ShieldCheck,
  Sprout,
  Gauge,
  Satellite,
  CloudRain,
  Droplets,
  Wind,
  BookOpen,
  MessageSquare,
  Send,
  Radio,
  LoaderCircle,
  Thermometer,
  FileDown,
  CalendarDays,
  MapPin,
  Clock3,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import FieldWeatherSnapshot from "@/components/FieldWeatherSnapshot";
import { formatNumber } from "@/lib/field";
import { getFieldLayerView, type FieldMapLayer } from "@/lib/field-layers";
import {
  sendSms2GQuery,
  type FieldAnalysis,
  type FieldRequest,
  type Sms2GResponse,
} from "@/services/agroShieldApi";
import type { CurrentWeather } from "@/services/fieldWeather";

interface WeatherWindow {
  minTemperatureC: number;
  maxTemperatureC: number;
  firstTemperatureC: number;
  lastTemperatureC: number;
  minHumidityPct: number | null;
  maxHumidityPct: number | null;
}

function getWeatherWindow(
  weather: CurrentWeather | null,
  startHour: number,
  endHour: number,
): WeatherWindow | null {
  if (!weather) return null;
  const readings = weather.hourlyForecast.filter((reading) => {
    const hour = Number(reading.time.slice(11, 13));
    return hour >= startHour && hour <= endHour;
  });
  if (readings.length === 0) return null;
  const temperatures = readings.map((reading) => reading.temperatureC);
  const humidities = readings
    .map((reading) => reading.relativeHumidityPct)
    .filter((humidity): humidity is number => humidity !== null);
  return {
    minTemperatureC: Math.min(...temperatures),
    maxTemperatureC: Math.max(...temperatures),
    firstTemperatureC: readings[0]?.temperatureC ?? temperatures[0] ?? 0,
    lastTemperatureC: readings[readings.length - 1]?.temperatureC ?? temperatures[0] ?? 0,
    minHumidityPct: humidities.length ? Math.min(...humidities) : null,
    maxHumidityPct: humidities.length ? Math.max(...humidities) : null,
  };
}

function formatTemperature(value: number) {
  return `${formatNumber(value)}°C`;
}

function formatTemperatureWindow(window: WeatherWindow | null, trend = false) {
  if (!window) return "Previsão horária indisponível";
  return trend
    ? `${formatTemperature(window.firstTemperatureC)} → ${formatTemperature(window.lastTemperatureC)}`
    : `${formatTemperature(window.minTemperatureC)}–${formatTemperature(window.maxTemperatureC)}`;
}

function formatHumidityWindow(window: WeatherWindow | null) {
  if (!window || window.minHumidityPct === null || window.maxHumidityPct === null) {
    return "Umidade horária indisponível";
  }
  return `UR ${formatNumber(window.minHumidityPct)}–${formatNumber(window.maxHumidityPct)}%`;
}

export default function AnalysisDashboard({
  field,
  initial,
  backendUrl,
  activeLayer,
  onLayerChange,
  mapWindow,
  currentWeather,
}: {
  field: FieldRequest;
  initial: FieldAnalysis;
  backendUrl: string;
  activeLayer: FieldMapLayer;
  onLayerChange: (layer: FieldMapLayer) => void;
  mapWindow: ReactNode;
  currentWeather: CurrentWeather | null;
}) {
  const [analysis, setAnalysis] = useState(initial);
  const [done, setDone] = useState<number[]>([]);
  const [technical, setTechnical] = useState(true);
  const [activeTab, setActiveTab] = useState<"tactical" | "rotation">("tactical");
  const [smsQuestion, setSmsQuestion] = useState(
    `Posso pulverizar ${field.crop} agora neste talhão?`,
  );
  const [smsPhone, setSmsPhone] = useState("");
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsReply, setSmsReply] = useState<Sms2GResponse | null>(null);
  const [showTwiml, setShowTwiml] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState("Soja → Milho + Braquiária");
  useEffect(() => {
    setAnalysis(initial);
    setDone([]);
  }, [initial]);
  const dailyMaximum =
    currentWeather?.maxTemperatureTodayC === null ||
    currentWeather?.maxTemperatureTodayC === undefined
      ? ""
      : ` (MÁX. ${formatTemperature(currentWeather.maxTemperatureTodayC)} PREVISTA HOJE · OPEN-METEO)`;
  const label =
    analysis.risk === "red"
      ? `VERMELHO — RISCO DE LIXIVIAÇÃO E ATOLAMENTO${dailyMaximum}`
      : analysis.risk === "yellow"
        ? `AMARELO — ATENÇÃO TÉRMICA E OPERACIONAL${dailyMaximum}`
        : `VERDE — CONDIÇÕES FAVORÁVEIS${dailyMaximum}`;
  const climateLabel =
    field.climateScenario === "el-nino-2023-24"
      ? "El Niño 2023/24"
      : field.climateScenario === "la-nina-2021-22"
        ? "La Niña 2021/22"
        : "Clima atual";
  const strategies = [
    {
      title: "Soja → Milho Solteiro",
      tag: "ROTAÇÃO ATUAL",
      score: 46,
      benefit: "Mantém o calendário produtivo e a renda da segunda safra.",
      risk: "Menor cobertura pode aumentar erosão e lixiviação.",
      limit: "Satélites não identificam compactação nem palhada no talhão.",
    },
    {
      title: "Soja → Milho + Braquiária",
      tag: "MAIS RESILIENTE",
      score: 89,
      benefit: "Eleva a palhada para até 85%, conserva umidade na seca e protege o solo nas chuvas.",
      risk: "Exige manejo do consórcio e controle da competição por água.",
      limit: "Não informa fertilidade nem a viabilidade local do consórcio.",
    },
    {
      title: "Soja → Aveia Preta / Trigo",
      tag: "ESTRATÉGIA ALTERNATIVA",
      score: 81,
      benefit: "Foco em proteção rápida do solo e controle de plantas daninhas.",
      risk: "Depende da janela de semeadura e do risco de geadas.",
      limit: "A resolução orbital não capta microclimas ou geadas pontuais.",
    },
  ];
  const layerButtons = [
    { id: "ndvi", Icon: Sprout },
    { id: "soil-moisture", Icon: Droplets },
    { id: "heat", Icon: Thermometer },
    { id: "cover", Icon: ShieldCheck },
  ] as const;
  const activeLayerView = getFieldLayerView(analysis, activeLayer, currentWeather);
  const isDemo = analysis.source === "demo";
  const displayedSoilMoisture = isDemo ? 68 : analysis.soilMoisture;
  const todayLabel = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  const displayedRain = currentWeather?.precipitationTodayMm ?? null;
  const displayedRainText = currentWeather
    ? formatNumber(currentWeather.precipitationTodayMm)
    : "—";
  const displayedRainLabel = currentWeather
    ? "Precipitação estimada hoje · Open-Meteo"
    : "Acumulado de hoje indisponível";
  const weatherWindows = {
    morning: getWeatherWindow(currentWeather, 6, 10),
    afternoon: getWeatherWindow(currentWeather, 11, 16),
    evening: getWeatherWindow(currentWeather, 17, 22),
  };
  const morningThermalStatus = weatherWindows.morning
    ? weatherWindows.morning.maxTemperatureC > 30
      ? "PAUSAR · LIMITE TÉRMICO >30°C"
      : "FAIXA TÉRMICA FAVORÁVEL"
    : "PREVISÃO HORÁRIA INDISPONÍVEL";
  const afternoonThermalStatus = weatherWindows.afternoon
    ? weatherWindows.afternoon.maxTemperatureC > 30
      ? "PAUSAR · LIMITE TÉRMICO >30°C"
      : "SEM BLOQUEIO TÉRMICO PREVISTO"
    : "PREVISÃO HORÁRIA INDISPONÍVEL";
  const eveningThermalStatus = weatherWindows.evening
    ? weatherWindows.evening.maxTemperatureC > 30
      ? "PAUSAR · LIMITE TÉRMICO >30°C"
      : "TEMPERATURA EM QUEDA / FAIXA FAVORÁVEL"
    : "PREVISÃO HORÁRIA INDISPONÍVEL";
  const displayedDemoWeatherContext = isDemo
    ? `O alerta agronômico é demonstrativo, não uma ordem de campo. ${currentWeather ? `Open-Meteo estima agora ${formatTemperature(currentWeather.temperatureC)} e máxima diária de ${currentWeather.maxTemperatureTodayC === null ? "indisponível" : formatTemperature(currentWeather.maxTemperatureTodayC)}; precipitação acumulada estimada ${displayedRainText} mm até ${currentWeather.time.slice(11, 16)}. ${currentWeather.maxTemperatureTodayC !== null && currentWeather.maxTemperatureTodayC <= 30 ? "O modelo não prevê ultrapassar 30°C; isso não libera pulverização sem confirmar vento, ΔT, umidade e bula do produto." : "Reavalie a pulverização nos horários em que a previsão exceder 30°C e confirme vento, ΔT, umidade e bula do produto."} São dados de modelo regional, não observação no talhão.` : "Não há telemetria meteorológica atual disponível; confirme as condições locais antes de qualquer operação."}`
    : null;
  const displayedGuidance = displayedDemoWeatherContext ?? analysis.guidance;
  const displayedTechnicalReason = displayedDemoWeatherContext ?? analysis.technicalReason;
  const windBlocked =
    typeof analysis.windSpeedKmh === "number" &&
    typeof analysis.windLimitKmh === "number" &&
    analysis.windSpeedKmh > analysis.windLimitKmh;
  const afternoonBlocked =
    weatherWindows.afternoon?.maxTemperatureC !== undefined &&
    weatherWindows.afternoon.maxTemperatureC > 30;
  const afternoonDetail = windBlocked
    ? `Vento ${analysis.windSpeedKmh} km/h · limite ${analysis.windLimitKmh} km/h`
    : analysis.deltaTStatus === "EVAPORACAO_ALTA"
      ? `ΔT ${analysis.deltaT}°C · evaporação elevada`
      : `${formatHumidityWindow(weatherWindows.afternoon)} · validar vento, ΔT e bula`;
  const trafficAttention = displayedSoilMoisture >= 65;
  const trafficDetail = trafficAttention
    ? `Umidade ${displayedSoilMoisture}% · atenção em baixadas; confirme suporte do solo antes de tráfego`
    : `Umidade ${displayedSoilMoisture}% · confirme trafegabilidade por vistoria local`;

  async function handleSendSms2G(event: React.FormEvent) {
    event.preventDefault();
    if (!smsQuestion.trim()) return;
    setSmsLoading(true);
    try {
      setSmsReply(await sendSms2GQuery(smsQuestion, field, backendUrl, analysis, smsPhone));
    } finally {
      setSmsLoading(false);
    }
  }

  function handleExportPdf() {
    const win = window.open("", "_blank", "width=900,height=720");
    if (!win) return;
    const esc = (v: unknown) =>
      String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const actionsHtml = analysis.actions.map((a) => `<li>${esc(a)}</li>`).join("");
    win.document.write(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Parecer AgroShield — ${esc(field.crop)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111827; padding: 32px; line-height: 1.5; }
    h1 { margin: 0 0 4px; font-size: 22px; color: #064E3B; }
    .meta { color: #4B5563; font-size: 13px; margin-bottom: 20px; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-weight: bold; font-size: 12px; background: #F3F4F6; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0; }
    .card { border: 1px solid #E5E7EB; border-radius: 8px; padding: 12px; }
    .card small { display: block; color: #6B7280; font-size: 11px; }
    .card strong { font-size: 18px; }
    h2 { font-size: 15px; margin-top: 20px; border-bottom: 1px solid #E5E7EB; padding-bottom: 4px; }
  </style>
</head>
<body>
  <h1>AgroShield — Parecer Técnico do Talhão</h1>
  <div class="meta">
    Cultura: <strong>${esc(field.crop)}</strong> · Área: <strong>${esc(formatNumber(field.areaHectares))} ha</strong> ·
    Coordenadas: ${esc(field.centroid.lat.toFixed(5))}, ${esc(field.centroid.lng.toFixed(5))} ·
    Emitido em: ${esc(new Date().toLocaleString("pt-BR"))}
  </div>
  <div class="badge">Status: ${esc(label)} · Manual: ${esc(analysis.manualSource || "EMBRAPA / Padrão Global")}</div>
  <div class="grid">
    <div class="card"><small>${esc(displayedRainLabel)}</small><strong>${esc(displayedRainText)} mm</strong></div>
    <div class="card"><small>Umidade Solo / Raiz SMAP</small><strong>${esc(displayedSoilMoisture)}%${typeof analysis.rootZoneMoisture === "number" ? ` / ${esc(analysis.rootZoneMoisture)}%` : ""}</strong></div>
    <div class="card"><small>Vento a 2m</small><strong>${esc(analysis.windSpeedKmh ?? "—")} km/h</strong></div>
    <div class="card"><small>Pressão Atmosférica</small><strong>${esc(analysis.pressureHpa ?? "—")} hPa</strong></div>
    <div class="card"><small>Delta-T / Umidade Relativa</small><strong>${typeof analysis.deltaT === "number" ? `${esc(analysis.deltaT)} °C (${esc(analysis.umidadeRelativaPct ?? "—")}%)` : "—"}</strong></div>
    <div class="card"><small>Score de Risco</small><strong>${esc(analysis.riskScore ?? "—")}/100</strong></div>
  </div>
  <h2>Orientação Tática</h2>
  <p>${esc(displayedGuidance)}</p>
  <h2>Checklist Operacional</h2>
  <ul>${actionsHtml}</ul>
  <h2>Fundamentação Técnica</h2>
  <p>${esc(displayedTechnicalReason)}</p>
</body>
</html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <div className="dashboard entrance">
      <header className="telemetry-heading">
        <div className="telemetry-title">
          <span className="eyebrow">CENTRO DE COMANDO AGRÍCOLA</span>
          <h1>Talhão <span>•</span> Campo Mourão, PR</h1>
          <span className={`telemetry-badge ${isDemo ? "is-demo" : "is-live"}`}>
            <i aria-hidden="true" />
            {isDemo ? "CENÁRIO DEMONSTRATIVO · SEM TELEMETRIA AO VIVO" : "TELEMETRIA API ATIVA"}
          </span>
        </div>
        <div className="telemetry-meta">
          <span><Sprout size={14} /> {field.crop}</span>
          <span className="telemetry-mono">{formatNumber(field.areaHectares)} ha</span>
          <span><CalendarDays size={14} /> {todayLabel}</span>
          <span className="telemetry-mono"><MapPin size={14} /> {field.centroid.lat.toFixed(5)}, {field.centroid.lng.toFixed(5)}</span>
        </div>
        <FieldWeatherSnapshot weather={currentWeather} />
      </header>
      <div className="analysis-dashboard-hero">
        {mapWindow}
        <div className="analysis-overview">
          <section className="field-layer-selector" aria-label="Camadas orbitais do talhão">
            <div className="layer-selector-heading">
              <div>
                <span className="eyebrow">SELETOR INTERATIVO</span>
                <h2>Telemetria do talhão</h2>
              </div>
              <span className="layer-change-hint">Selecione para pintar o polígono</span>
            </div>
            <div
              className="field-layer-buttons"
              role="group"
              aria-label="Selecionar camada do mapa"
            >
              {layerButtons.map(({ id, Icon }) => {
                const view = getFieldLayerView(analysis, id, currentWeather);
                const outsideIdeal =
                  view.progress !== null &&
                  (view.progress.value < view.progress.idealStart ||
                    view.progress.value > view.progress.idealEnd);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`field-layer-button ${activeLayer === id ? "is-active" : ""} ${outsideIdeal ? "is-warning" : ""}`}
                    aria-pressed={activeLayer === id}
                    aria-label={`${view.title}: ${view.buttonValue}`}
                    onClick={() => onLayerChange(id)}
                  >
                    <span className="layer-card-title"><Icon size={16} /> {view.buttonLabel}</span>
                    <strong className="telemetry-mono">{view.buttonValue}</strong>
                    <span className="layer-card-status">{view.status}</span>
                    {view.progress && (
                      <span
                        className={`layer-progress ${outsideIdeal ? "is-outside" : "is-ideal"}`}
                        role="img"
                        aria-label={`Valor ${view.progress.value} de ${view.progress.max}; zona ideal ${view.progress.idealStart} a ${view.progress.idealEnd}`}
                      >
                        <i
                          className="layer-progress-ideal"
                          style={{
                            left: `${(view.progress.idealStart / view.progress.max) * 100}%`,
                            width: `${((view.progress.idealEnd - view.progress.idealStart) / view.progress.max) * 100}%`,
                          }}
                        />
                        <i
                          className="layer-progress-value"
                          style={{ width: `${(view.progress.value / view.progress.max) * 100}%` }}
                        />
                        <i
                          className="layer-progress-marker"
                          style={{ left: `${(view.progress.value / view.progress.max) * 100}%` }}
                        />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="field-layer-detail" aria-live="polite">
              <div className="layer-detail-heading">
                <div>
                  <span className="eyebrow">CAMADA ATIVA</span>
                  <h3>{activeLayerView.title}</h3>
                </div>
                <span className="layer-status">{activeLayerView.status}</span>
              </div>
              <p>{activeLayerView.whyItMatters}</p>
              <span className="layer-source">
                <Satellite size={13} /> {activeLayerView.source}
              </span>
              {activeLayerView.isDemo && (
                <small className="layer-demo-note">
                  Valor demonstrativo, não é uma observação orbital ao vivo.
                </small>
              )}
            </div>
          </section>
        </div>
      </div>
      <div className={`risk-banner risk-${analysis.risk}`}>
        <AlertTriangle size={25} />
        <div className="risk-copy">
          <span className="eyebrow">
            {isDemo ? "ALERTA DO CENÁRIO · NÃO É LEITURA AO VIVO" : "ALERTA OPERACIONAL DE HOJE"}
            {typeof analysis.riskScore === "number"
              ? ` · ÍNDICE ${analysis.riskScore}/100`
              : ""}
          </span>
          <h2>{label}</h2>
          <p className="tactical-order">{displayedGuidance}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleExportPdf}
          aria-label="Exportar parecer em PDF"
        >
          <FileDown size={15} /> Exportar PDF
        </Button>
      </div>
      <section className="operations-panel" aria-label="Janela operacional de hoje">
        <div className="operations-heading">
          <div>
            <span className="eyebrow">JANELA OPERACIONAL DE HOJE</span>
            <h2><Clock3 size={16} /> Timeline de campo</h2>
          </div>
          <span className={`data-mode-chip ${isDemo ? "is-demo" : ""}`}>
            {currentWeather ? "TEMPERATURA · OPEN-METEO" : "SEM PREVISÃO HORÁRIA"}
          </span>
        </div>
        <div className="timeline-grid">
          <div className={`timeline-cell ${weatherWindows.morning ? "timeline-good" : "timeline-muted"}`}>
            <div className="timeline-period-heading">
              <strong>Manhã <small>06h–10h30</small></strong>
              <b className="telemetry-mono">{formatTemperatureWindow(weatherWindows.morning)}</b>
              <small>{formatHumidityWindow(weatherWindows.morning)}</small>
            </div>
            <div className="timeline-operation">
              <span>Pulverização</span>
              <strong className={weatherWindows.morning?.maxTemperatureC && weatherWindows.morning.maxTemperatureC > 30 ? "timeline-blocked" : "timeline-good"}>
                {morningThermalStatus}
              </strong>
              <small>Confirme vento, ΔT e bula do produto; temperatura sozinha não libera a aplicação.</small>
            </div>
            <div className="timeline-operation">
              <span>Maquinário</span>
              <strong className={trafficAttention ? "timeline-warning" : "timeline-muted"}>
                {trafficAttention ? "ATENÇÃO EM BAIXADAS" : "VISTORIA LOCAL"}
              </strong>
              <small>{trafficDetail}{isDemo ? " (indicador demonstrativo)" : ""}</small>
            </div>
          </div>
          <div className={`timeline-cell ${weatherWindows.afternoon ? (afternoonBlocked ? "timeline-blocked" : "timeline-warning") : "timeline-muted"}`}>
            <div className="timeline-period-heading">
              <strong>Tarde <small>10h30–17h</small></strong>
              <b className="telemetry-mono">{formatTemperatureWindow(weatherWindows.afternoon)}</b>
              <small>{formatHumidityWindow(weatherWindows.afternoon)}</small>
            </div>
            <div className="timeline-operation">
              <span>Pulverização</span>
              <strong className={afternoonBlocked ? "timeline-blocked" : "timeline-warning"}>
                {afternoonThermalStatus}
              </strong>
              <small>{afternoonDetail}. Temperatura prevista não substitui vento, ΔT ou rótulo.</small>
            </div>
            <div className="timeline-operation">
              <span>Maquinário</span>
              <strong className="timeline-warning">VISTORIA ANTES DO TRÁFEGO</strong>
              <small>Sem medição de suporte do solo ou compactação no talhão.</small>
            </div>
          </div>
          <div className={`timeline-cell ${weatherWindows.evening ? "timeline-good" : "timeline-muted"}`}>
            <div className="timeline-period-heading">
              <strong>Fim de tarde / noite <small>17h–22h</small></strong>
              <b className="telemetry-mono">{formatTemperatureWindow(weatherWindows.evening, true)}</b>
              <small>{formatHumidityWindow(weatherWindows.evening)}</small>
            </div>
            <div className="timeline-operation">
              <span>Pulverização</span>
              <strong className={weatherWindows.evening?.maxTemperatureC && weatherWindows.evening.maxTemperatureC > 30 ? "timeline-blocked" : "timeline-good"}>
                {eveningThermalStatus}
              </strong>
              <small>Revalidar vento, ΔT e umidade relativa antes de qualquer aplicação.</small>
            </div>
            <div className="timeline-operation">
              <span>Maquinário</span>
              <strong className="timeline-warning">REAVALIAR CONDIÇÃO DO SOLO</strong>
              <small>Use vistoria presencial; umidade orbital não mede trafegabilidade.</small>
            </div>
          </div>
        </div>
      </section>
      <div className="dashboard-tabs" role="tablist" aria-label="Painéis da análise">
        <button
          type="button"
          role="tab"
          id="tab-tactical"
          aria-selected={activeTab === "tactical"}
          aria-controls="panel-tactical"
          onClick={() => setActiveTab("tactical")}
        >
          Alerta Tático
        </button>
        <button
          type="button"
          role="tab"
          id="tab-rotation"
          aria-selected={activeTab === "rotation"}
          aria-controls="panel-rotation"
          onClick={() => setActiveTab("rotation")}
        >
          Rotação de Culturas
        </button>
      </div>
      {analysis.manualSource && (
        <div className="field-summary">
          <span><BookOpen size={14} /> Manual oficial: {analysis.manualSource} ({analysis.regionCode || "BR"})</span>
          <span>Stress test: {climateLabel} · {isDemo ? "cenário demonstrativo" : "diagnóstico do back-end"}</span>
        </div>
      )}
      {analysis.fallbackReason && (
        <p className="fallback-notice" role="status">
          {analysis.fallbackReason}
        </p>
      )}
      {activeTab === "tactical" && (
        <div
          className="dashboard-panel"
          id="panel-tactical"
          role="tabpanel"
          aria-labelledby="tab-tactical"
        >
          {analysis.operationPlan && (
            <section
              className={`operation-plan-card plan-${analysis.operationPlan.veredito.toLowerCase()}`}
            >
              <div className="operation-plan-top">
                <div>
                  <span className="eyebrow">
                    PARECER DIRETO DO MANUAL OFICIAL (SEM DEPENDER DA IA)
                  </span>
                  <h3>
                    {analysis.operationPlan.operacao} em {analysis.operationPlan.data}
                    {analysis.operationPlan.diasAteAcao === 0
                      ? " (Hoje)"
                      : ` (daqui a ${analysis.operationPlan.diasAteAcao} dias)`}
                    {" · "}
                    {analysis.operationPlan.veredito === "LIBERADA"
                      ? "LIBERADA"
                      : analysis.operationPlan.veredito === "ATENCAO"
                        ? "ATENÇÃO"
                        : "NÃO RECOMENDADA"}
                  </h3>
                </div>
                <div className="operation-accuracy-badge">
                  <strong>{analysis.operationPlan.precisaoPrevisaoPct}%</strong>
                  <span>acerto estimado</span>
                </div>
              </div>
              <p className="operation-plan-rec">{analysis.operationPlan.recomendacao}</p>
              <div className="operation-plan-meta">
                <span>
                  <strong>Solo:</strong> {analysis.operationPlan.soloAnalisado}
                </span>
                <span>
                  <strong>Base da previsão:</strong> {analysis.operationPlan.horizonteDescricao}
                </span>
                <span>
                  <strong>Manual:</strong> {analysis.operationPlan.fonteOficial}
                </span>
              </div>
            </section>
          )}
          <div className="dashboard-grid">
            <section className="tactical">
              <div className="section-heading">
                <div className="section-icon">
                  <AlertTriangle size={21} />
                </div>
                <div>
                  <span className="eyebrow">AÇÃO IMEDIATA</span>
                  <h2>Orientação tática</h2>
                </div>
                <span className="small-badge">Próximas 24h</span>
              </div>
              <p className="guidance">{displayedGuidance}</p>
              <div className="task-heading">
                Plano de ação <span>{done.length}/3 concluídas</span>
              </div>
              <div className="task-list">
                {analysis.actions.map((action, i) => (
                  <label key={action} className={done.includes(i) ? "task-done" : ""}>
                    <input
                      type="checkbox"
                      checked={done.includes(i)}
                      onChange={() =>
                        setDone((prev) =>
                          prev.includes(i) ? prev.filter((n) => n !== i) : [...prev, i],
                        )
                      }
                    />
                    <span>{action}</span>
                  </label>
                ))}
              </div>
            </section>
            <section className="science">
              <div className="section-heading">
                <div className="section-icon">
                  <Satellite size={21} />
                </div>
                <div>
                  <span className="eyebrow">EVIDÊNCIA CLIMÁTICA</span>
                  <h2>Os números por trás do alerta</h2>
                </div>
              </div>
              <div className="weather-values">
                <div>
                  <CloudRain size={18} />
                  <strong>
                    {displayedRainText} <small>mm</small>
                  </strong>
                  <span>
                    {displayedRainLabel}
                  </span>
                </div>
                <div>
                  <Droplets size={18} />
                  <strong>
                    {displayedSoilMoisture}
                    <small>%</small>
                  </strong>
                  <span>
                    Solo sup.{" "}
                    {typeof analysis.rootZoneMoisture === "number"
                      ? `(Raiz SMAP: ${analysis.rootZoneMoisture}%`
                      : "(GWETTOP"}
                    {typeof analysis.soilTempC === "number" ? ` · ${analysis.soilTempC}°C)` : ")"}
                  </span>
                </div>
                {typeof analysis.windSpeedKmh === "number" && (
                  <div>
                    <Wind size={18} />
                    <strong>
                      {analysis.windSpeedKmh} <small>km/h</small>
                    </strong>
                    <span>Vento 2m (limite {analysis.windLimitKmh ?? 10} km/h)</span>
                  </div>
                )}
                {typeof analysis.pressureHpa === "number" && (
                  <div>
                    <Gauge size={18} />
                    <strong>
                      {analysis.pressureHpa} <small>hPa</small>
                    </strong>
                    <span>
                      Pressão ({analysis.pressureTrend === "QUEDA_BRUSCA"
                        ? "Queda brusca · frente"
                        : analysis.pressureTrend === "INSTAVEL"
                          ? "Instável"
                          : "Estável"}
                      {typeof analysis.pressureDropHpa === "number" && analysis.pressureDropHpa < 0
                        ? ` · ${analysis.pressureDropHpa} hPa`
                        : ""})
                    </span>
                  </div>
                )}
                {typeof analysis.deltaT === "number" && (
                  <div>
                    <Thermometer size={18} />
                    <strong>
                      {analysis.deltaT} <small>°C ΔT</small>
                    </strong>
                    <span>
                      Pulverização:{" "}
                      {analysis.deltaTStatus === "IDEAL"
                        ? "Ideal (2–8°C)"
                        : analysis.deltaTStatus === "EVAPORACAO_ALTA"
                          ? "Evaporação alta (>10°C)"
                          : "Atenção"}
                      {typeof analysis.umidadeRelativaPct === "number"
                        ? ` · UR ${analysis.umidadeRelativaPct}%`
                        : ""}
                    </span>
                  </div>
                )}
              </div>
              {analysis.markov && (
                <div className="markov-strip">
                  <strong>
                    Tendência Estocástica (Cadeia de Markov · {analysis.markov.diasAnalisados}d
                    NASA):
                  </strong>
                  <span>
                    Janela seca em 3 dias: <b>{analysis.markov.janelaSeca3dPct}%</b> · Persistência
                    de risco em 7 dias: <b>{analysis.markov.persistenciaRisco7dPct}%</b>
                  </span>
                </div>
              )}
              {analysis.ensemble14d && (
                <div className="markov-strip">
                  <strong>
                    Previsão por Conjunto (Ensemble · {analysis.ensemble14d.totalMembros} cenários,
                    Dias 8–14):
                  </strong>
                  <span>
                    Consenso de <b>{analysis.ensemble14d.confiancaConsensoPct}%</b> para semana{" "}
                    <b>{analysis.ensemble14d.tendenciaSemana2.toLowerCase()}</b> (mediana{" "}
                    {analysis.ensemble14d.chuvaMedianaSemana2Mm} mm
                    {analysis.ensemble14d.balancoHidrico7dMm !== null
                      ? ` · Balanço hídrico 7d: ${analysis.ensemble14d.balancoHidrico7dMm >= 0 ? "+" : ""}${analysis.ensemble14d.balancoHidrico7dMm} mm`
                      : ""}
                    )
                  </span>
                </div>
              )}
              {analysis.biophysModel && (
                <div className="markov-strip">
                  <strong>Saúde e capacidade do solo (bₜ &amp; Memória Rₜ):</strong>
                  <span>
                    Condição:{" "}
                    <b>
                      {analysis.biophysModel.crencaHmm.regimeDominante === "SATURADO_ESTRESSE"
                        ? "Solo encharcado"
                        : analysis.biophysModel.crencaHmm.regimeDominante === "SECO_FAVORAVEL"
                          ? "Solo seco"
                          : "Condição ideal"}
                    </b>{" "}
                    (Ideal {analysis.biophysModel.crencaHmm.probabilidadesPct.ideal}% · Encharcado{" "}
                    {analysis.biophysModel.crencaHmm.probabilidadesPct.saturado}%) · Infiltração
                    (INFₜ):{" "}
                    <b>{analysis.biophysModel.estadoBiofisico.infiltracaoEstimadaMmH} mm/h</b> ·
                    Melhor decisão agora (π*):{" "}
                    <b>{analysis.biophysModel.politicaOtima.acaoOtima}</b>
                  </span>
                </div>
              )}
              {(analysis.elevation || analysis.hourlyWindow) && (
                <div className="markov-strip">
                  <strong>Relevo do Talhão &amp; Janela Horária (24h):</strong>
                  <span>
                    {analysis.elevation && (
                      <>
                        Altitude <b>{analysis.elevation.altitudeMediaM} m</b> · Desnível{" "}
                        <b>{analysis.elevation.desnivelM} m</b> (declividade{" "}
                        {analysis.elevation.declividadePct}%)
                      </>
                    )}
                    {analysis.elevation && analysis.hourlyWindow && " · "}
                    {analysis.hourlyWindow && (
                      <>
                        Pulverização hoje: <b>{analysis.hourlyWindow.resumo}</b>
                      </>
                    )}
                  </span>
                </div>
              )}
                <div className="rain-chart-heading">
                  <div>
                    <span className="eyebrow">
                      {isDemo
                        ? "DEMONSTRAÇÃO · REFERÊNCIAS NASA GPM / POWER"
                        : `${analysis.dataSources || "DADOS DO BACK-END"} · BALANÇO HÍDRICO`}
                    </span>
                    <h3>Precipitação: média histórica × acumulado de hoje</h3>
                  </div>
                  <span>{displayedRainLabel}</span>
                </div>
              <div className="rain-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[
                      { name: "Histórico NASA", normal: analysis.historicalRain },
                      {
                        name: currentWeather
                          ? "Acumulado hoje Open-Meteo"
                          : "Acumulado hoje indisponível",
                        forecast: displayedRain,
                      },
                    ]}
                    margin={{ top: 12, right: 15, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    />
                    <YAxis
                      unit=" mm"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                    />
                    <Tooltip cursor={false} />
                    <Bar
                      dataKey="normal"
                      name="Média histórica (mm)"
                      fill="var(--primary)"
                      radius={[4, 4, 0, 0]}
                      barSize={56}
                    />
                    <Bar
                      dataKey="forecast"
                      name={displayedRainLabel}
                      fill={`var(--${analysis.risk === "red" ? "destructive" : analysis.risk === "yellow" ? "warning" : "safe"})`}
                      radius={[4, 4, 0, 0]}
                      barSize={56}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <Button
                variant="ghost"
                className="technical-toggle"
                onClick={() => setTechnical(!technical)}
                aria-expanded={technical}
              >
                Justificativa técnica ({analysis.manualSource || "EMBRAPA / ZARC"}){" "}
                <ChevronDown className={technical ? "rotate-180" : ""} />
              </Button>
              {technical && <p className="technical-copy">{displayedTechnicalReason}</p>}
            </section>
          </div>
          <section className="sms-section">
            <div className="section-heading">
              <div className="section-icon">
                <MessageSquare size={21} />
              </div>
              <div>
                <span className="eyebrow">CONTINGÊNCIA OFFLINE 2G • TWILIO WEBHOOK</span>
                <h2>Comunicação por SMS 2G (Sem Internet no Campo)</h2>
              </div>
              <span className="small-badge">
                <Radio size={12} className="inline mr-1" />
                POST /api/sms-responder · Máx 150 chars
              </span>
            </div>
            {analysis.smsAlert && (
              <div className="sms-outbound-alert" role="status">
                <strong>
                  Alerta Vermelho 2G Disparado Automaticamente ({analysis.smsAlert.caracteres}/150
                  chars para {analysis.smsAlert.para}):
                </strong>
                <p>"{analysis.smsAlert.mensagem}"</p>
              </div>
            )}
            <form className="sms-simulator-form" onSubmit={handleSendSms2G}>
              <label htmlFor="sms-input" className="form-label">
                Simular SMS enviado pelo agricultor do trator (rede 2G GSM)
                <span>Trava pós-IA e escapamento TwiML ativos</span>
              </label>
              <div className="sms-input-row">
                <input
                  id="sms-phone"
                  type="tel"
                  className="select-control"
                  style={{ maxWidth: "230px" }}
                  value={smsPhone}
                  onChange={(event) => setSmsPhone(event.target.value)}
                  placeholder="Telefone real (opcional, ex.: 44999874707)"
                  aria-label="Telefone para envio real de SMS (opcional)"
                />
                <input
                  id="sms-input"
                  type="text"
                  className="select-control"
                  value={smsQuestion}
                  onChange={(event) => setSmsQuestion(event.target.value)}
                  placeholder="Ex.: Posso pulverizar a soja agora?"
                  required
                />
                <Button type="submit" disabled={smsLoading}>
                  {smsLoading ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <Send size={15} />
                  )}
                  {smsLoading ? "Consultando..." : "Enviar SMS 2G"}
                </Button>
              </div>
            </form>
            {smsReply && (
              <div className="sms-reply-card">
                <div className="sms-reply-header">
                  <span>
                    <strong>Resposta SMS 2G ({smsReply.caracteres}/150 caracteres)</strong> · Fonte:{" "}
                    {smsReply.fonte_manual} ({smsReply.regiao})
                    {smsReply.enviado_sms_real ? " · 📲 SMS real enviado!" : ""}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowTwiml((visible) => !visible)}
                  >
                    {showTwiml ? "Ocultar TwiML XML" : "Ver Payload TwiML (Twilio)"}
                  </Button>
                </div>
                <p className="sms-reply-bubble">{smsReply.resposta_sms}</p>
                {showTwiml && <pre className="sms-twiml-code">{smsReply.twiml}</pre>}
              </div>
            )}
          </section>
        </div>
      )}
      {activeTab === "rotation" && (
        <section
          className="rotation-section dashboard-panel"
          id="panel-rotation"
          role="tabpanel"
          aria-labelledby="tab-rotation"
        >
          <div className="section-heading">
            <div className="section-icon">
              <ShieldCheck size={23} />
            </div>
            <div>
              <span className="eyebrow">PLANEJAMENTO DA PRÓXIMA SAFRA</span>
              <h2>Escudo de rotação de culturas</h2>
            </div>
          </div>
          <p className="section-subtitle">
            Compare três estratégias para a próxima safra. Pontuações são indicativas, não uma prescrição agronômica.
          </p>
          <div className="rotation-grid">
            {strategies.map((s, i) => (
              <article
                key={s.title}
                className={`rotation-card ${i === 1 ? "recommended" : ""} ${selectedStrategy === s.title ? "is-selected" : ""}`}
              >
                <span className="eyebrow">
                  {i === 1 && <Check size={14} />} {s.tag}
                </span>
                <h3>{s.title}</h3>
                <div className="resilience">
                  <strong>
                    {s.score}
                    <small>/100</small>
                  </strong>
                  <span>Resiliência estimada</span>
                </div>
                <progress value={s.score} max={100} />
                <p className="rotation-summary">
                  {i === 0
                    ? "Risco alto de erosão e perda de adubo."
                    : i === 1
                      ? "Mais palhada, retenção de umidade e proteção no período chuvoso."
                      : "Proteção rápida do solo e apoio ao controle de plantas daninhas."}
                </p>
                <dl>
                  <dt>Benefício principal</dt>
                  <dd>{s.benefit}</dd>
                  <dt>Risco agronômico</dt>
                  <dd>{s.risk}</dd>
                  <dt>Limitação dos dados de satélite</dt>
                  <dd>{s.limit}</dd>
                </dl>
                <span className="strategy-footnote">
                  Pontuação ilustrativa · validar com agrônomo
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant={selectedStrategy === s.title ? "default" : "outline"}
                  aria-pressed={selectedStrategy === s.title}
                  onClick={() => setSelectedStrategy(s.title)}
                >
                  {selectedStrategy === s.title ? "Selecionada" : "Selecionar estratégia"}
                </Button>
              </article>
            ))}
          </div>
          <details className="scientific-transparency">
            <summary>Transparência Científica: Fontes NASA &amp; Limitações (Data Gaps)</summary>
            <div className="scientific-source-list">
              {["NASA POWER", "SMAP", "GPM", "MODIS", "SRTM"].map((source) => (
                <span key={source}>{source}</span>
              ))}
            </div>
            <p>
              As fontes acima são referências de dados e camadas previstas pela plataforma; a disponibilidade
              depende da integração ativa. Dados orbitais não substituem análise química do solo e não detectam
              compactação profunda ou nematoides. Confirme recomendações com vistoria local e assistência técnica.
            </p>
          </details>
        </section>
      )}
      <p className="disclaimer">
        AgroShield apoia decisões, mas não substitui assistência agronômica nem alertas oficiais da
        Defesa Civil.
      </p>
    </div>
  );
}
