import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ShieldCheck,
  Sprout,
  Satellite,
  CloudRain,
  Droplets,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/field";
import type { FieldAnalysis, FieldRequest } from "@/services/agroShieldApi";

export default function AnalysisDashboard({
  field,
  initial,
}: {
  field: FieldRequest;
  initial: FieldAnalysis;
}) {
  const [analysis, setAnalysis] = useState(initial);
  const [done, setDone] = useState<number[]>([]);
  const [technical, setTechnical] = useState(false);
  const [activeTab, setActiveTab] = useState<"tactical" | "rotation">("tactical");
  useEffect(() => {
    setAnalysis(initial);
    setDone([]);
  }, [initial]);
  const label =
    analysis.risk === "red"
      ? "PERIGO SEVERO"
      : analysis.risk === "yellow"
        ? "ATENÇÃO"
        : "OPERAÇÃO NORMAL";
  const climateLabel =
    field.climateScenario === "el-nino-2023-24"
      ? "El Niño 2023/24"
      : field.climateScenario === "la-nina-2021-22"
        ? "La Niña 2021/22"
        : "Clima atual";
  const strategies = [
    {
      title: field.currentRotation,
      tag: "ROTAÇÃO ATUAL",
      score: 45,
      benefit: "Mantém o calendário produtivo e a renda da segunda safra.",
      risk: "Menor cobertura pode aumentar erosão e lixiviação.",
      limit: "Satélites não identificam compactação nem palhada no talhão.",
    },
    {
      title: "Soja → Milho + Braquiária",
      tag: "MAIS RESILIENTE",
      score: 88,
      benefit: "Palhada protege o solo, reduz perda de nutrientes e melhora o tráfego de máquinas.",
      risk: "Exige manejo do consórcio e controle da competição por água.",
      limit: "Não informa fertilidade nem a viabilidade local do consórcio.",
    },
    {
      title: "Soja → Aveia Preta / Trigo",
      tag: "ESTRATÉGIA ALTERNATIVA",
      score: 82,
      benefit: "Cobertura rápida e raízes favorecem a infiltração da água.",
      risk: "Depende da janela de semeadura e do risco de geadas.",
      limit: "A resolução orbital não capta microclimas ou geadas pontuais.",
    },
  ];
  return (
    <div className="dashboard entrance">
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
      <div className={`risk-banner risk-${analysis.risk}`}>
        <AlertTriangle size={30} />
        <div>
          <span className="eyebrow">ALERTA DO TALHÃO</span>
          <h2>{label}</h2>
        </div>
        <span className="risk-source">
          <Satellite size={15} />{" "}
          {analysis.source === "demo"
            ? "Monitoramento simulado • NASA GPM"
            : "Monitoramento ativo • API conectada"}
        </span>
      </div>
      <div className="field-summary">
        <span>
          <Sprout size={16} /> {field.crop} · {formatNumber(field.areaHectares)} ha
        </span>
        <span>
          {field.centroid.lat.toFixed(5)}, {field.centroid.lng.toFixed(5)}
        </span>
        <span>
          Stress test: {climateLabel} ·{" "}
          {analysis.source === "demo" ? "demonstração, não é previsão real" : "resultado da API"}
        </span>
      </div>
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
              <p className="guidance">{analysis.guidance}</p>
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
                    {analysis.predictedRain} <small>mm</small>
                  </strong>
                  <span>Chuva no cenário</span>
                </div>
                <div>
                  <Droplets size={18} />
                  <strong>
                    {analysis.soilMoisture}
                    <small>%</small>
                  </strong>
                  <span>Umidade estimada</span>
                </div>
              </div>
              <div className="rain-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[
                      { name: "Histórico", normal: analysis.historicalRain },
                      { name: "Cenário NASA", forecast: analysis.predictedRain },
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
                      name="Cenário (mm)"
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
                Justificativa técnica <ChevronDown className={technical ? "rotate-180" : ""} />
              </Button>
              {technical && <p className="technical-copy">{analysis.technicalReason}</p>}
            </section>
          </div>
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
            Resiliência começa no solo. Compare caminhos para proteger o próximo ciclo.
          </p>
          <div className="rotation-grid">
            {strategies.map((s, i) => (
              <article key={s.title} className={`rotation-card ${i === 1 ? "recommended" : ""}`}>
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
              </article>
            ))}
          </div>
        </section>
      )}
      <p className="disclaimer">
        AgroShield apoia decisões, mas não substitui assistência agronômica nem alertas oficiais da
        Defesa Civil.
      </p>
    </div>
  );
}
