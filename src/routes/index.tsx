import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Leaf,
  LoaderCircle,
  LockKeyhole,
  Pentagon,
  Radio,
  RotateCcw,
  Satellite,
  ShieldCheck,
  Sprout,
  Trash2,
  Wheat,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import AnalysisDashboard from "@/components/AnalysisDashboard";
import {
  calculateField,
  EXAMPLE_FIELD,
  INITIAL_CENTER,
  formatNumber,
  type Coordinate,
  type Crop,
} from "@/lib/field";
import {
  analyzeField,
  type ClimateScenario,
  type FieldAnalysis,
  type FieldRequest,
  type PlannedOperation,
  type Risk,
} from "@/services/agroShieldApi";

const FieldMap = lazy(() => import("@/components/FieldMap"));
const rotations = ["Soja → Milho Safrinha", "Monocultura de Soja", "Soja → Trigo"];
const plannedOperations: PlannedOperation[] = ["Pulverizar", "Plantar", "Adubar", "Colher"];
const checks = [
  "Extraindo centroide e coordenadas do polígono...",
  "Consultando satélites NASA GPM & POWER (Precipitação e Umidade)...",
  "Cruzando anomalias climáticas do El Niño...",
  "Gerando orientação tática e estratégias de rotação via IA...",
];
const climateScenarios: { value: ClimateScenario; label: string }[] = [
  { value: "current", label: "Clima Atual" },
  { value: "el-nino-2023-24", label: "Simular El Niño 2023/24" },
  { value: "la-nina-2021-22", label: "Simular La Niña 2021/22" },
];
function isClimateScenario(value: string): value is ClimateScenario {
  return climateScenarios.some((scenario) => scenario.value === value);
}
function isPlannedOperation(value: string): value is PlannedOperation {
  return plannedOperations.some((operation) => operation === value);
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AgroShield | Proteção do talhão com vigia espacial" },
      {
        name: "description",
        content:
          "Selecione seu talhão, simule alertas climáticos e compare estratégias de rotação com o AgroShield. NASA Space Apps 2026 • Field Shift.",
      },
      { property: "og:title", content: "AgroShield | Proteção do talhão com vigia espacial" },
      {
        property: "og:description",
        content:
          "Alerta tático agrícola e planejamento de resiliência climática para produtores rurais.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [step, setStep] = useState(1);
  const [points, setPoints] = useState<Coordinate[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [center, setCenter] = useState<Coordinate>(INITIAL_CENTER);
  const [crop, setCrop] = useState<Crop>("Soja");
  const [rotation, setRotation] = useState(rotations[0] ?? "Soja → Milho Safrinha");
  const [climateScenario, setClimateScenario] = useState<ClimateScenario>("current");
  const [plannedOperation, setPlannedOperation] = useState<PlannedOperation>("Pulverizar");
  const [plannedDate, setPlannedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [backendUrl, setBackendUrl] = useState("http://localhost:3000");
  const [urlDraft, setUrlDraft] = useState("http://localhost:3000");
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<FieldAnalysis | null>(null);
  const [request, setRequest] = useState<FieldRequest | null>(null);
  const [simulatingRisk, setSimulatingRisk] = useState<Risk | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const sidebarRef = useRef<HTMLElement>(null);
  const runId = useRef(0);
  const field = calculateField(points);

  useEffect(
    () => () => {
      runId.current += 1;
    },
    [],
  );
  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const observer = new ResizeObserver(() => setLayoutVersion((version) => version + 1));
    observer.observe(sidebar);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (step !== 2) return;
    const timer = window.setInterval(() => setProgress((value) => Math.min(value + 3, 94)), 130);
    return () => window.clearInterval(timer);
  }, [step]);

  async function activate() {
    if (!field || drawing || field.areaHectares <= 0) return;
    const id = ++runId.current;
    const payload: FieldRequest = {
      polygon: points,
      ...field,
      crop,
      currentRotation: rotation,
      climateScenario,
      plannedOperation,
      plannedDate,
    };
    setRequest(payload);
    setProgress(0);
    setStep(2);
    const [response] = await Promise.all([
      analyzeField(payload, backendUrl),
      new Promise((resolve) => window.setTimeout(resolve, 4500)),
    ]);
    if (id !== runId.current) return;
    setProgress(100);
    window.setTimeout(() => {
      if (id === runId.current) {
        setResult(response);
        setStep(3);
        setMobileExpanded(true);
      }
    }, 500);
  }

  async function simulateScenario(risk: Risk) {
    if (!request) return;
    setSimulatingRisk(risk);
    try {
      setResult(await analyzeField({ ...request, simulateRisk: risk }, backendUrl));
    } finally {
      setSimulatingRisk(null);
    }
  }

  function reset() {
    runId.current += 1;
    setStep(1);
    setResult(null);
    setRequest(null);
    setPoints([]);
    setDrawing(false);
    setCenter(INITIAL_CENTER);
    setMobileExpanded(false);
  }

  function saveConnection(event: React.FormEvent) {
    event.preventDefault();
    try {
      const url = new URL(urlDraft);
      if (!["https:", "http:"].includes(url.protocol)) throw new Error();
      setBackendUrl(urlDraft.trim().replace(/\/$/, ""));
      setConnectionOpen(false);
      setUrlError("");
    } catch {
      setUrlError("Informe um endereço válido, começando com https://.");
    }
  }

  function startDrawing() {
    setStep(1);
    setResult(null);
    setPoints([]);
    setDrawing(true);
  }

  return (
    <div
      className={`map-app-shell ${mobileExpanded ? "sheet-expanded" : ""} ${step === 2 ? "loading-fullscreen" : ""} ${step === 3 ? "analysis-fullscreen" : ""}`}
    >
      {step === 2 && (
        <>
          <div className="loading-backdrop" aria-hidden="true" />
          <div className="loading-fill" style={{ height: `${progress}%` }} aria-hidden="true" />
        </>
      )}
      {step !== 3 && (
        <div className={step === 2 ? "map-under-loading" : undefined}>
          <div className="map-app-map" aria-label="Mapa de satélite interativo">
            <ClientOnly fallback={<div className="field-map" />}>
              <Suspense fallback={<div className="field-map" />}>
                <FieldMap
                  points={points}
                  onPointsChange={setPoints}
                  drawing={drawing}
                  center={center}
                  onCenterChange={setCenter}
                  layoutVersion={layoutVersion}
                  focusBounds={step === 2}
                />
              </Suspense>
            </ClientOnly>
          </div>
        </div>
      )}
      {step === 1 && (
        <div className="map-toolbar" aria-label="Ferramentas do mapa">
          <Button
            variant={drawing ? "default" : "outline"}
            size="sm"
            disabled={drawing && points.length < 3}
            onClick={() => {
              if (drawing) setDrawing(false);
              else startDrawing();
            }}
          >
            <Pentagon />
            {drawing ? "Concluir Talhão" : "Desenhar Talhão"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={points.length === 0 && !drawing}
            onClick={() => {
              setPoints([]);
              setDrawing(false);
              if (step !== 1) setStep(1);
            }}
          >
            <Trash2 /> Limpar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setStep(1);
              setPoints(EXAMPLE_FIELD);
              setDrawing(false);
              setCenter(INITIAL_CENTER);
            }}
          >
            Usar Exemplo
          </Button>
        </div>
      )}

      <aside
        ref={sidebarRef}
        className={`map-sidebar ${collapsed && step === 1 ? "is-collapsed" : ""} ${mobileExpanded ? "mobile-expanded" : ""} ${step === 2 ? "loading-view" : ""} ${step === 3 ? "analysis-view" : ""}`}
        aria-label="Painel AgroShield"
      >
        {step === 1 && (
          <button
            className="sidebar-collapse desktop-only"
            type="button"
            aria-label={collapsed ? "Expandir painel" : "Recolher painel"}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
          </button>
        )}
        {step === 1 && (
          <button
            className="sheet-handle mobile-only"
            type="button"
            aria-label={mobileExpanded ? "Recolher painel" : "Expandir painel"}
            onClick={() => setMobileExpanded((value) => !value)}
          >
            <span />
          </button>
        )}

        <header className="sidebar-header">
          <div className="sidebar-brand">
            <div className="brand-icon">
              <ShieldCheck size={34} strokeWidth={1.8} />
            </div>
            <div className="brand-copy">
              <div className="brand-name">
                Agro<span>Shield</span>
              </div>
              <div className="brand-caption">NASA Space Apps 2026 • Field Shift</div>
            </div>
          </div>
          <Button
            variant="outline"
            className="connection-badge"
            onClick={() => {
              setUrlDraft(backendUrl);
              setConnectionOpen(true);
            }}
          >
            <span className="live-dot" />{" "}
            {backendUrl ? "API · NASA POWER / GPM" : "DEMO · NASA POWER / GPM"}{" "}
            <ChevronDown size={14} />
          </Button>
        </header>

        {(!collapsed || step !== 1) && (
          <div className="sidebar-scroll">
            {step === 1 && (
              <section className="field-setup">
                <div className="sidebar-section-heading">
                  <span className="eyebrow">CONFIGURAÇÃO DO TALHÃO</span>
                  <h1>Seu campo, em foco.</h1>
                  <p>Delimite a área no mapa e prepare sua análise.</p>
                </div>
                <div className="area-strip sidebar-area">
                  <Pentagon size={21} />
                  <div>
                    <strong>
                      {drawing
                        ? "Desenho em andamento"
                        : field
                          ? "Talhão selecionado"
                          : "Nenhum talhão selecionado"}
                    </strong>
                    <p>
                      {field
                        ? `${field.centroid.lat.toFixed(5)}, ${field.centroid.lng.toFixed(5)} · centroide`
                        : drawing
                          ? `${points.length} vértices · mínimo de 3`
                          : "Use a ferramenta no mapa para delimitar"}
                    </p>
                  </div>
                  <span>
                    {field ? formatNumber(field.areaHectares) : "—"} <small>ha</small>
                  </span>
                </div>

                <div className="form-label">
                  Cultura atual <span>Selecione uma opção</span>
                </div>
                <div className="crop-grid">
                  {(
                    [
                      { name: "Soja", Icon: Sprout },
                      { name: "Milho", Icon: Wheat },
                      { name: "Trigo", Icon: Leaf },
                    ] as const
                  ).map(({ name, Icon }) => (
                    <Button
                      key={name}
                      variant="crop"
                      data-selected={crop === name}
                      aria-pressed={crop === name}
                      onClick={() => setCrop(name)}
                    >
                      <Icon strokeWidth={1.5} />
                      {name}
                    </Button>
                  ))}
                </div>

                <label className="form-label" htmlFor="rotation">
                  Rotação atual <span>Opcional</span>
                </label>
                <select
                  id="rotation"
                  className="select-control"
                  value={rotation}
                  onChange={(event) => setRotation(event.target.value)}
                >
                  {rotations.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>

                <div className="operation-inputs">
                  <div className="operation-field">
                    <label className="form-label" htmlFor="planned-op">
                      O que vai fazer?
                    </label>
                    <select
                      id="planned-op"
                      className="select-control"
                      value={plannedOperation}
                      onChange={(event) => {
                        if (isPlannedOperation(event.target.value))
                          setPlannedOperation(event.target.value);
                      }}
                    >
                      <option value="Pulverizar">Pulverizar</option>
                      <option value="Plantar">Plantar / Semear</option>
                      <option value="Adubar">Adubar</option>
                      <option value="Colher">Colher</option>
                    </select>
                  </div>
                  <div className="operation-field">
                    <label className="form-label" htmlFor="planned-date">
                      Data prevista
                    </label>
                    <input
                      id="planned-date"
                      type="date"
                      className="select-control"
                      value={plannedDate}
                      onChange={(event) => setPlannedDate(event.target.value)}
                    />
                  </div>
                </div>

                <label className="form-label climate-label" htmlFor="climate-scenario">
                  Stress test climático <span>Opcional</span>
                </label>
                <select
                  id="climate-scenario"
                  className="select-control"
                  value={climateScenario}
                  onChange={(event) => {
                    if (isClimateScenario(event.target.value))
                      setClimateScenario(event.target.value);
                  }}
                >
                  {climateScenarios.map((scenario) => (
                    <option key={scenario.value} value={scenario.value}>
                      {scenario.label}
                    </option>
                  ))}
                </select>

                <div className="field-details">
                  <div className="detail-row">
                    <span>Área monitorada</span>
                    <strong>
                      {field ? `${formatNumber(field.areaHectares)} hectares` : "A definir"}
                    </strong>
                  </div>
                  <div className="detail-row">
                    <span>Fonte de referência</span>
                    <strong>NASA GPM + POWER</strong>
                  </div>
                  <div className="detail-row">
                    <span>Tipo de análise</span>
                    <strong>{backendUrl ? "API externa" : "Demonstração"}</strong>
                  </div>
                </div>
                <Button
                  className="activate-button"
                  size="action"
                  disabled={!field || drawing || field.areaHectares <= 0}
                  onClick={activate}
                >
                  <Satellite size={17} /> Analisar Talhão com Dados NASA <ArrowRight size={16} />
                </Button>
                <p className="activation-note">
                  <LockKeyhole size={10} className="inline mr-1" />
                  {field
                    ? "Pronto para iniciar a análise"
                    : "Desenhe ou carregue um talhão para continuar"}
                </p>
                <div className="sidebar-source-note">
                  <ShieldCheck size={17} /> Dados demonstrativos são identificados; não representam
                  observações NASA ao vivo.
                </div>
              </section>
            )}

            {step === 2 && (
              <section className="sidebar-processing entrance" aria-live="polite">
                <div className="loading-orbit" aria-hidden="true">
                  <div className="loading-orbit-core">
                    <Satellite size={34} />
                  </div>
                  <span />
                </div>
                <span className="eyebrow">VIGIA ESPACIAL ATIVADA</span>
                <h1>Analisando seu talhão</h1>
                <p>O mapa está enquadrando a área selecionada.</p>
                <progress max={100} value={progress} />
                <div className="progress-caption">
                  <span>{backendUrl ? "Processamento da análise" : "Simulação demonstrativa"}</span>
                  <strong>{progress}%</strong>
                </div>
                <div className="processing-list">
                  {checks.map((text, index) => {
                    const finished = progress >= (index + 1) * 24;
                    const current = !finished && progress >= index * 24;
                    return (
                      <div
                        key={text}
                        className={`processing-item ${finished ? "finished" : current ? "current" : ""}`}
                      >
                        {finished ? (
                          <Check size={17} />
                        ) : current ? (
                          <LoaderCircle size={17} className="animate-spin" />
                        ) : (
                          <span className="step-number">{index + 1}</span>
                        )}
                        <span>{!backendUrl ? `Simulação: ${text}` : text}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {step === 3 && result && request && (
              <AnalysisDashboard field={request} initial={result} backendUrl={backendUrl} />
            )}
            <footer className="sidebar-legal">
              AgroShield © 2026 · Field Shift{" "}
              <span>
                <Radio size={11} /> {backendUrl ? "API externa" : "Demonstração · dados simulados"}
              </span>
            </footer>
          </div>
        )}

        {!collapsed && step === 3 && result && (
          <footer className="sidebar-result-footer">
            <Button variant="outline" size="action" onClick={reset}>
              <RotateCcw /> Editar Talhão / Nova Análise
            </Button>
            <div className="scenario-control">
              <span>Simular risco</span>
              {(["green", "yellow", "red"] as Risk[]).map((risk) => (
                <Button
                  key={risk}
                  variant="outline"
                  size="sm"
                  aria-pressed={result.risk === risk}
                  disabled={simulatingRisk !== null}
                  onClick={() => void simulateScenario(risk)}
                >
                  <span className={`scenario-dot risk-${risk}`} />
                  {simulatingRisk === risk
                    ? "Calculando..."
                    : risk === "green"
                      ? "Verde"
                      : risk === "yellow"
                        ? "Amarelo"
                        : "Vermelho"}
                </Button>
              ))}
            </div>
          </footer>
        )}
      </aside>

      {connectionOpen && (
        <div
          className="connection-dialog"
          onClick={(event) => {
            if (event.target === event.currentTarget) setConnectionOpen(false);
          }}
        >
          <section
            className="connection-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connection-title"
          >
            <div className="flex items-center justify-between">
              <h2 id="connection-title">Fonte da análise</h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Fechar"
                onClick={() => setConnectionOpen(false)}
              >
                <X />
              </Button>
            </div>
            <p>
              Use a demonstração de Campo Mourão ou conecte sua API Node.js. A API deve aceitar a
              análise de talhão e permitir acesso pelo navegador. Não inclua chaves privadas no
              endereço.
            </p>
            <form onSubmit={saveConnection}>
              <label htmlFor="backend-url" className="form-label">
                Endereço da API Node.js
              </label>
              <input
                id="backend-url"
                type="url"
                className="select-control"
                placeholder="https://sua-api.com.br"
                value={urlDraft}
                onChange={(event) => setUrlDraft(event.target.value)}
                required
              />
              {urlError && <p role="alert">{urlError}</p>}
              <div className="dialog-actions">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setBackendUrl("");
                    setConnectionOpen(false);
                  }}
                >
                  Modo Demo
                </Button>
                <Button type="submit">Conectar API Node.js</Button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
