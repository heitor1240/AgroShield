import { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ShieldCheck, Sprout, Satellite, RotateCcw, CloudRain, Droplets, Wind, BookOpen, MessageSquare, Send, Radio, LoaderCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/field';
import { analyzeField, makeDemoAnalysis, sendSms2GQuery, type FieldAnalysis, type FieldRequest, type Risk, type Sms2GResponse } from '@/services/agroShieldApi';

export default function AnalysisDashboard({
  field,
  initial,
  onReset,
  backendUrl = 'http://localhost:3000',
}: {
  field: FieldRequest;
  initial: FieldAnalysis;
  onReset: () => void;
  backendUrl?: string;
}) {
  const [analysis, setAnalysis] = useState(initial);
  const [done, setDone] = useState<number[]>([]);
  const [technical, setTechnical] = useState(true);
  const [simulatingRisk, setSimulatingRisk] = useState<Risk | null>(null);

  // Estado do Simulador Bidirecional SMS 2G Offline (conectado ao POST /api/sms-responder do back-end)
  const [smsQuestion, setSmsQuestion] = useState(`Posso pulverizar ${field.crop} agora neste talhão?`);
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsReply, setSmsReply] = useState<Sms2GResponse | null>(null);
  const [smsError, setSmsError] = useState('');
  const [showTwiml, setShowTwiml] = useState(false);

  const label = analysis.risk === 'red' ? 'PERIGO SEVERO' : analysis.risk === 'yellow' ? 'ATENÇÃO' : 'OPERAÇÃO NORMAL';
  const strategies = [
    { title: field.currentRotation, tag: 'ROTAÇÃO ATUAL', score: 45, benefit: 'Mantém o calendário produtivo e a renda da segunda safra.', risk: 'Menor cobertura pode aumentar erosão e lixiviação.', limit: 'Satélites não identificam compactação nem palhada no talhão.' },
    { title: 'Soja → Milho + Braquiária', tag: 'MAIS RESILIENTE', score: 88, benefit: 'Palhada protege o solo, reduz perda de nutrientes e melhora o tráfego de máquinas.', risk: 'Exige manejo do consórcio e controle da competição por água.', limit: 'Não informa fertilidade nem a viabilidade local do consórcio.' },
    { title: 'Soja → Aveia Preta / Trigo', tag: 'ESTRATÉGIA ALTERNATIVA', score: 82, benefit: 'Cobertura rápida e raízes favorecem a infiltração da água.', risk: 'Depende da janela de semeadura e do risco de geadas.', limit: 'A resolução orbital não capta microclimas ou geadas pontuais.' },
  ];

  async function handleSimulateScenario(risk: Risk) {
    setDone([]);
    if (!backendUrl?.trim()) {
      setAnalysis(makeDemoAnalysis(risk));
      return;
    }
    try {
      setSimulatingRisk(risk);
      const updated = await analyzeField({ ...field, simulateRisk: risk }, backendUrl);
      setAnalysis(updated);
    } catch {
      setAnalysis(makeDemoAnalysis(risk));
    } finally {
      setSimulatingRisk(null);
    }
  }

  async function handleSendSms2G(e: React.FormEvent) {
    e.preventDefault();
    if (!smsQuestion.trim()) return;
    setSmsLoading(true);
    setSmsError('');
    try {
      const res = await sendSms2GQuery(smsQuestion, field, backendUrl);
      setSmsReply(res);
    } catch {
      setSmsError('Não foi possível contatar a rota POST /api/sms-responder no back-end.');
    } finally {
      setSmsLoading(false);
    }
  }

  return <div className="dashboard entrance">
    <div className={`risk-banner risk-${analysis.risk}`}><AlertTriangle size={30} /><div><span className="eyebrow">ALERTA DO TALHÃO{typeof analysis.riskScore === 'number' ? ` · ÍNDICE DE RISCO ${analysis.riskScore}/100` : ''}</span><h2>{label}</h2></div><span className="risk-source"><Satellite size={15} /> {analysis.source === 'demo' ? 'Monitoramento simulado • NASA GPM' : `${analysis.dataSources || 'NASA POWER'} • ${analysis.manualSource || 'IA'}`}</span></div>
    <div className="field-summary">
      <span><Sprout size={16} /> {field.crop} · {formatNumber(field.areaHectares)} ha</span>
      <span>{field.centroid.lat.toFixed(5)}, {field.centroid.lng.toFixed(5)}</span>
      {analysis.manualSource && <span><BookOpen size={15} /> Manual Oficial: <strong>{analysis.manualSource}</strong> ({analysis.regionCode || 'BR'})</span>}
      <span>{analysis.source === 'demo' ? 'Cenário demonstrativo · não é previsão real' : 'Diagnóstico auditado pelo Back-end AgroShield'}</span>
    </div>
    {analysis.fallbackReason && <p className="fallback-notice" role="status">{analysis.fallbackReason}</p>}
    {analysis.operationPlan && (
      <section className={`operation-plan-card plan-${analysis.operationPlan.veredito.toLowerCase()}`}>
        <div className="operation-plan-top">
          <div>
            <span className="eyebrow">PARECER DIRETO DO MANUAL OFICIAL (SEM DEPENDER DA IA)</span>
            <h3>
              {analysis.operationPlan.operacao} em {analysis.operationPlan.data}
              {analysis.operationPlan.diasAteAcao === 0 ? ' (Hoje)' : ` (daqui a ${analysis.operationPlan.diasAteAcao} dias)`}
              {' · '}
              {analysis.operationPlan.veredito === 'LIBERADA'
                ? 'LIBERADA'
                : analysis.operationPlan.veredito === 'ATENCAO'
                  ? 'ATENÇÃO'
                  : 'NÃO RECOMENDADA'}
            </h3>
          </div>
          <div className="operation-accuracy-badge">
            <strong>{analysis.operationPlan.precisaoPrevisaoPct}%</strong>
            <span>acerto estimado</span>
          </div>
        </div>
        <p className="operation-plan-rec">{analysis.operationPlan.recomendacao}</p>
        <div className="operation-plan-meta">
          <span><strong>Solo:</strong> {analysis.operationPlan.soloAnalisado}</span>
          <span><strong>Base da previsão:</strong> {analysis.operationPlan.horizonteDescricao}</span>
          <span><strong>Manual:</strong> {analysis.operationPlan.fonteOficial}</span>
        </div>
      </section>
    )}
    <div className="dashboard-grid">
      <section className="tactical"><div className="section-heading"><div className="section-icon"><AlertTriangle size={21} /></div><div><span className="eyebrow">AÇÃO IMEDIATA</span><h2>Orientação tática</h2></div><span className="small-badge">{analysis.regionName || 'Próximas 24h'}</span></div><p className="guidance">{analysis.guidance}</p><div className="task-heading">Plano de ação <span>{done.length}/3 concluídas</span></div><div className="task-list">{analysis.actions.map((action, i) => <label key={action} className={done.includes(i) ? 'task-done' : ''}><input type="checkbox" checked={done.includes(i)} onChange={() => setDone(prev => prev.includes(i) ? prev.filter(n => n !== i) : [...prev, i])} /><span>{action}</span></label>)}</div></section>
      <section className="science"><div className="section-heading"><div className="section-icon"><Satellite size={21} /></div><div><span className="eyebrow">EVIDÊNCIA CLIMÁTICA + ATERRAMENTO</span><h2>Os números por trás do alerta</h2></div></div><div className="weather-values"><div><CloudRain size={18} /><strong>{analysis.predictedRain} <small>mm</small></strong><span>Chuva NASA ({analysis.rainLimitMm ? ` máx ${analysis.rainLimitMm}mm` : '48h'})</span></div><div><Droplets size={18} /><strong>{analysis.soilMoisture}<small>%</small></strong><span>Solo sup. {typeof analysis.rootZoneMoisture === 'number' ? `(Raiz SMAP: ${analysis.rootZoneMoisture}%` : '(GWETTOP'}{typeof analysis.soilTempC === 'number' ? ` · ${analysis.soilTempC}°C)` : ')'}</span></div>{typeof analysis.windSpeedKmh === 'number' && <div><Wind size={18} /><strong>{analysis.windSpeedKmh} <small>km/h</small></strong><span>Vento 2m (limite {analysis.windLimitKmh ?? 10} km/h)</span></div>}</div>{analysis.markov && <div className="markov-strip"><strong>Tendência Estocástica (Cadeia de Markov · {analysis.markov.diasAnalisados}d NASA):</strong><span>Janela seca em 3 dias: <b>{analysis.markov.janelaSeca3dPct}%</b> · Persistência de risco em 7 dias: <b>{analysis.markov.persistenciaRisco7dPct}%</b></span></div>}
{analysis.ensemble14d && <div className="markov-strip"><strong>Previsão por Conjunto (Ensemble · {analysis.ensemble14d.totalMembros} cenários, Dias 8–14):</strong><span>Consenso de <b>{analysis.ensemble14d.confiancaConsensoPct}%</b> para semana <b>{analysis.ensemble14d.tendenciaSemana2.toLowerCase()}</b> (mediana {analysis.ensemble14d.chuvaMedianaSemana2Mm} mm{analysis.ensemble14d.balancoHidrico7dMm !== null ? ` · Balanço hídrico 7d: ${analysis.ensemble14d.balancoHidrico7dMm >= 0 ? '+' : ''}${analysis.ensemble14d.balancoHidrico7dMm} mm` : ''})</span></div>}<div className="rain-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={[{ name: 'Histórico NASA', normal: analysis.historicalRain }, { name: 'Pico NASA POWER', forecast: analysis.predictedRain }]} margin={{ top: 12, right: 15, left: -20, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} /><YAxis unit=" mm" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><Tooltip cursor={false} /><Bar dataKey="normal" name="Média histórica (mm)" fill="var(--primary)" radius={[4, 4, 0, 0]} barSize={56} /><Bar dataKey="forecast" name="Pico NASA (mm)" fill={`var(--${analysis.risk === 'red' ? 'destructive' : analysis.risk === 'yellow' ? 'warning' : 'safe'})`} radius={[4, 4, 0, 0]} barSize={56} /></BarChart></ResponsiveContainer></div><Button variant="ghost" className="technical-toggle" onClick={() => setTechnical(!technical)} aria-expanded={technical}>Justificativa técnica ({analysis.manualSource || 'EMBRAPA / ZARC'}) <ChevronDown className={technical ? 'rotate-180' : ''} /></Button>{technical && <p className="technical-copy">{analysis.technicalReason}</p>}</section>
    </div>

    <section className="sms-section">
      <div className="section-heading">
        <div className="section-icon"><MessageSquare size={21} /></div>
        <div>
          <span className="eyebrow">CONTINGÊNCIA OFFLINE 2G • TWILIO WEBHOOK</span>
          <h2>Comunicação por SMS 2G (Sem Internet no Campo)</h2>
        </div>
        <span className="small-badge"><Radio size={12} className="inline mr-1" />POST /api/sms-responder · Máx 150 chars</span>
      </div>

      {analysis.smsAlert && (
        <div className="sms-outbound-alert" role="status">
          <strong>📲 Alerta Vermelho 2G Disparado Automaticamente ({analysis.smsAlert.caracteres}/150 chars para {analysis.smsAlert.para}):</strong>
          <p>"{analysis.smsAlert.mensagem}"</p>
        </div>
      )}

      <form className="sms-simulator-form" onSubmit={handleSendSms2G}>
        <label htmlFor="sms-input" className="form-label">
          Simular SMS enviado pelo agricultor do trator (rede 2G GSM)
          <span>Trava Pós-IA + Escapamento XML TwiML ativos</span>
        </label>
        <div className="sms-input-row">
          <input
            id="sms-input"
            type="text"
            className="select-control"
            value={smsQuestion}
            onChange={e => setSmsQuestion(e.target.value)}
            placeholder="Ex: Posso pulverizar a soja agora em Campo Mourão?"
          />
          <Button type="submit" disabled={smsLoading}>
            {smsLoading ? <LoaderCircle size={16} className="animate-spin" /> : <Send size={15} />}
            {smsLoading ? 'Consultando...' : 'Enviar SMS 2G'}
          </Button>
        </div>
      </form>

      {smsError && <p className="fallback-notice">{smsError}</p>}

      {smsReply && (
        <div className="sms-reply-card">
          <div className="sms-reply-header">
            <span><strong>Resposta SMS 2G ({smsReply.caracteres}/150 caracteres)</strong> · Fonte: {smsReply.fonte_manual} ({smsReply.regiao})</span>
            <Button variant="ghost" size="sm" onClick={() => setShowTwiml(!showTwiml)}>
              {showTwiml ? 'Ocultar TwiML XML' : 'Ver Payload TwiML (Twilio)'}
            </Button>
          </div>
          <p className="sms-reply-bubble">{smsReply.resposta_sms}</p>
          {showTwiml && <pre className="sms-twiml-code">{smsReply.twiml}</pre>}
        </div>
      )}
    </section>

    <section className="rotation-section"><div className="section-heading"><div className="section-icon"><ShieldCheck size={23} /></div><div><span className="eyebrow">PLANEJAMENTO DA PRÓXIMA SAFRA</span><h2>Escudo de rotação de culturas</h2></div></div><p className="section-subtitle">Resiliência começa no solo. Compare caminhos para proteger o próximo ciclo.</p><div className="rotation-grid">{strategies.map((s, i) => <article key={s.title} className={`rotation-card ${i === 1 ? 'recommended' : ''}`}><span className="eyebrow">{i === 1 && <Check size={14} />} {s.tag}</span><h3>{s.title}</h3><div className="resilience"><strong>{s.score}<small>/100</small></strong><span>Resiliência estimada</span></div><progress value={s.score} max={100} /><dl><dt>Benefício principal</dt><dd>{s.benefit}</dd><dt>Risco agronômico</dt><dd>{s.risk}</dd><dt>Limitação dos dados de satélite</dt><dd>{s.limit}</dd></dl><span className="strategy-footnote">Pontuação ilustrativa · validar com agrônomo</span></article>)}</div></section>
    <div className="dashboard-footer"><Button variant="outline" size="action" onClick={onReset}><RotateCcw /> Nova Análise / Outro Talhão</Button><div className="scenario-control"><span>Simular cenário no Back-end</span>{(['green', 'yellow', 'red'] as Risk[]).map(risk => <Button key={risk} variant="outline" size="sm" disabled={simulatingRisk !== null} aria-pressed={analysis.risk === risk} onClick={() => handleSimulateScenario(risk)}><span className={`scenario-dot risk-${risk}`} />{simulatingRisk === risk ? 'Calculando...' : risk === 'green' ? 'Verde' : risk === 'yellow' ? 'Amarelo' : 'Vermelho'}</Button>)}</div></div><p className="disclaimer">AgroShield apoia decisões, mas não substitui assistência agronômica nem alertas oficiais da Defesa Civil.</p>
  </div>;
}