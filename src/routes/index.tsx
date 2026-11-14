import { createFileRoute, ClientOnly } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ShieldCheck, Satellite, ChevronDown, MapPin, Pentagon, Trash2, ArrowRight, Sprout, Wheat, Leaf, Flower2, ScanLine, Check, LoaderCircle, LockKeyhole, ArrowUpRight, Navigation, Radio, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { calculateField, EXAMPLE_FIELD, INITIAL_CENTER, formatNumber, type Coordinate, type Crop } from '@/lib/field';
import { analyzeField, type FieldAnalysis, type FieldRequest, type PlannedOperation } from '@/services/agroShieldApi';
import AnalysisDashboard from '@/components/AnalysisDashboard';

const FieldMap = lazy(() => import('@/components/FieldMap'));
export const Route = createFileRoute('/')({
  head: () => ({ meta: [
    { title: 'AgroShield | Proteção do talhão com vigia espacial' },
    { name: 'description', content: 'Selecione seu talhão, simule alertas climáticos e compare estratégias de rotação com o AgroShield. NASA Space Apps 2026 • Field Shift.' },
    { property: 'og:title', content: 'AgroShield | Proteção do talhão com vigia espacial' },
    { property: 'og:description', content: 'Alerta tático agrícola e planejamento de resiliência climática para produtores rurais.' },
    { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: Index,
});
const rotations = ['Soja → Milho Safrinha', 'Monocultura de Soja', 'Soja → Trigo'];
const checks = ['Extraindo centroide e coordenadas do polígono...', 'Consultando satélites NASA GPM & POWER (Precipitação e Umidade)...', 'Cruzando anomalias climáticas do El Niño...', 'Gerando orientação tática e estratégias de rotação via IA...'];

function Index() {
  const [step, setStep] = useState(1);
  const [points, setPoints] = useState<Coordinate[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [center, setCenter] = useState<Coordinate>(INITIAL_CENTER);
  const [crop, setCrop] = useState<Crop>('Soja');
  const [rotation, setRotation] = useState(rotations[0] ?? 'Soja → Milho Safrinha');
  const [plannedOperation, setPlannedOperation] = useState<PlannedOperation>('Pulverizar');
  const [plannedDate, setPlannedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [backendUrl, setBackendUrl] = useState('http://localhost:3000');
  const [urlDraft, setUrlDraft] = useState('http://localhost:3000');
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<FieldAnalysis | null>(null);
  const [request, setRequest] = useState<FieldRequest | null>(null);
  const runId = useRef(0);
  const field = calculateField(points);
  useEffect(() => { return () => { runId.current += 1; }; }, []);
  useEffect(() => {
    if (step !== 2) return;
    const timer = window.setInterval(() => setProgress(p => Math.min(p + 3, 94)), 130);
    return () => window.clearInterval(timer);
  }, [step]);
  async function activate() {
    if (!field || drawing || field.areaHectares <= 0) return;
    const id = ++runId.current;
    const payload = { polygon: points, ...field, crop, currentRotation: rotation, plannedOperation, plannedDate };
    setRequest(payload); setProgress(0); setStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const [response] = await Promise.all([analyzeField(payload, backendUrl), new Promise(resolve => window.setTimeout(resolve, 4500))]);
    if (id !== runId.current) return;
    setProgress(100);
    window.setTimeout(() => { if (id === runId.current) { setResult(response); setStep(3); } }, 500);
  }
  function reset() { runId.current += 1; setStep(1); setResult(null); setPoints([]); setDrawing(false); setCenter(INITIAL_CENTER); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function saveConnection(e: React.FormEvent) {
    e.preventDefault();
    try { const url = new URL(urlDraft); if (!['https:', 'http:'].includes(url.protocol)) throw new Error(); setBackendUrl(urlDraft.trim().replace(/\/$/, '')); setConnectionOpen(false); setUrlError(''); }
    catch { setUrlError('Informe um endereço válido, começando com https://.'); }
  }
  return <>
    <header className="app-header"><div className="header-inner"><div className="brand"><div className="brand-icon"><ShieldCheck size={39} strokeWidth={1.8} /></div><div><div className="brand-name">Agro<span>Shield</span></div><div className="brand-caption">Inteligência espacial no campo</div></div><div className="event-badge"><Satellite size={18} /><div><strong>NASA Space Apps 2026</strong><br />Field Shift</div></div></div><Button variant="outline" className="mode-button" onClick={() => { setUrlDraft(backendUrl); setConnectionOpen(true); }}><span className="live-dot" />{backendUrl ? 'API conectada' : 'Modo Demo'}<span className="mode-location">· Campo Mourão, PR</span><ChevronDown /></Button></div></header>
    <main className="main-container">
      <nav className="stepper" aria-label="Etapas da análise">{['Seleção da área', 'Vigia espacial', 'Orientação tática'].map((label, i) => <div key={label} className="contents">{i > 0 && <span className="step-line" />}<div className={`step ${step === i + 1 ? 'active' : step > i + 1 ? 'completed' : ''}`} aria-current={step === i + 1 ? 'step' : undefined}><span className="step-number">{step > i + 1 ? <Check size={13} /> : `0${i + 1}`}</span><span>{label}</span></div></div>)}</nav>
      {step === 1 && <div className="entrance"><div className="page-heading"><div><span className="eyebrow">SEU CAMPO. NOSSA VIGIA.</span><h1>Onde vamos proteger?</h1><p>Selecione seu talhão e deixe a inteligência espacial cuidar do próximo passo.</p></div><span className="region-label"><MapPin size={15} /> Região de Campo Mourão · Paraná</span></div>
        <div className="selection-grid"><section className="map-panel"><div className="map-panel-heading"><span className="map-title"><ScanLine size={17} className="text-primary" /> Delimite sua área de cultivo</span><span className="small-badge">Imagem de satélite</span></div><ClientOnly fallback={<div className="field-map" />}><Suspense fallback={<div className="field-map" />}><FieldMap points={points} onPointsChange={setPoints} drawing={drawing} center={center} onCenterChange={setCenter} /></Suspense></ClientOnly><div className="map-tools"><Button variant={drawing ? 'default' : 'outline'} size="sm" disabled={drawing && points.length < 3} onClick={() => { if (drawing) setDrawing(false); else { setPoints([]); setDrawing(true); } }}><Pentagon />{drawing ? 'Concluir Talhão' : 'Desenhar Talhão'}</Button><Button variant="ghost" size="sm" disabled={points.length === 0 && !drawing} onClick={() => { setPoints([]); setDrawing(false); }}><Trash2 /> Limpar Desenho</Button><Button variant="link" size="sm" className="example-button" onClick={() => { setPoints(EXAMPLE_FIELD); setDrawing(false); setCenter(INITIAL_CENTER); }}>Usar Talhão de Exemplo <ArrowUpRight /></Button></div><div className="area-strip"><Pentagon size={24} /><div><strong>{field ? 'Talhão selecionado' : 'Nenhum talhão selecionado'}</strong><p>{drawing ? `${points.length} vértices · mínimo de 3 para concluir` : field ? `${field.centroid.lat.toFixed(5)}, ${field.centroid.lng.toFixed(5)} · centroide` : 'Aguardando delimitação da área'}</p></div><span>{field ? formatNumber(field.areaHectares) : '—'} <small>ha</small></span></div></section>
          <section className="field-panel"><h2 className="panel-heading"><Sprout size={21} /> Seu talhão, em detalhes</h2><div className="form-label">Cultura atual <span>Selecione uma opção</span></div><div className="crop-grid">{([{ name: 'Soja', Icon: Sprout }, { name: 'Milho', Icon: Wheat }, { name: 'Trigo', Icon: Leaf }, { name: 'Outro', Icon: Flower2 }] as const).map(({ name, Icon }) => <Button variant="crop" data-selected={crop === name} aria-pressed={crop === name} key={name} onClick={() => setCrop(name)}><Icon strokeWidth={1.5} />{name}</Button>)}</div><label className="form-label" htmlFor="rotation">Rotação atual <span>Opcional</span></label><select id="rotation" className="select-control" value={rotation} onChange={e => setRotation(e.target.value)}>{rotations.map(r => <option key={r}>{r}</option>)}</select><div className="operation-inputs"><div className="operation-field"><label className="form-label" htmlFor="planned-op">O que vai fazer?</label><select id="planned-op" className="select-control" value={plannedOperation} onChange={e => setPlannedOperation(e.target.value as PlannedOperation)}><option value="Pulverizar">Pulverizar</option><option value="Plantar">Plantar / Semear</option><option value="Adubar">Adubar</option><option value="Colher">Colher</option></select></div><div className="operation-field"><label className="form-label" htmlFor="planned-date">Data prevista</label><input id="planned-date" type="date" className="select-control" value={plannedDate} onChange={e => setPlannedDate(e.target.value)} /></div></div><div className="field-details"><div className="detail-row"><span>Área monitorada</span><strong>{field ? `${formatNumber(field.areaHectares)} hectares` : 'A definir'}</strong></div><div className="detail-row"><span>Fonte de referência</span><strong>NASA GPM + POWER</strong></div><div className="detail-row"><span>Tipo de análise</span><strong>{backendUrl ? 'API externa' : 'Demonstração'}</strong></div></div><Button className="activate-button" size="action" disabled={!field || drawing || field.areaHectares <= 0} onClick={activate}><Satellite size={17} /> Ativar Vigia Espacial NASA <ArrowRight size={16} /></Button><p className="activation-note"><LockKeyhole size={10} className="inline mr-1" />{field ? 'Tudo pronto para iniciar sua análise' : 'Selecione um talhão para iniciar a análise'}</p></section></div>
        <div className="source-strip"><ShieldCheck size={27} strokeWidth={1.5} /><div><strong>Dados do espaço. Decisões com os pés no chão.</strong><p>Precipitação, umidade e resiliência do solo em uma orientação direta para o seu campo.</p></div><div className="source-tags"><span>NASA GPM</span><span>NASA POWER</span><span>FIELD SHIFT</span></div></div>
      </div>}
      {step === 2 && <section className="processing entrance" aria-live="polite"><div className="orbital-icon"><Satellite size={54} strokeWidth={1.3} /></div><span className="eyebrow">VIGIA ESPACIAL ATIVADA</span><h1>Um olhar do espaço para o seu campo.</h1><p>{backendUrl ? 'Conectando sua área à API de análise.' : 'Preparando seu diagnóstico demonstrativo.'}</p><progress max={100} value={progress} /><div className="progress-caption"><span>{backendUrl ? 'Analisando seu talhão' : 'Simulação · sem consulta NASA ao vivo'}</span><strong>{progress}%</strong></div><div className="processing-list">{checks.map((text, i) => { const finished = progress >= (i + 1) * 24; const current = !finished && progress >= i * 24; return <div key={text} className={`processing-item ${finished ? 'finished' : current ? 'current' : ''}`}>{finished ? <Check size={18} /> : current ? <LoaderCircle size={18} className="animate-spin" /> : <span className="step-number">{i + 1}</span>}<span>{!backendUrl ? `Simulação: ${text}` : text}</span></div>; })}</div></section>}
      {step === 3 && result && request && <><div className="page-heading"><div><span className="eyebrow">INTELIGÊNCIA QUE VIRA AÇÃO</span><h1>Seu campo, sob proteção.</h1><p>Orientação imediata e um plano mais resiliente para a próxima safra.</p></div></div><AnalysisDashboard field={request} initial={result} onReset={reset} backendUrl={backendUrl} /></>}
      <footer className="app-footer"><span>AgroShield © 2026 · NASA Space Apps Challenge · Field Shift</span><span><Radio size={11} />{backendUrl ? 'API externa configurada' : 'Ambiente demonstrativo · dados simulados'}</span></footer>
    </main>
    {connectionOpen && <div className="connection-dialog" onClick={e => { if (e.target === e.currentTarget) setConnectionOpen(false); }}><section className="connection-content" role="dialog" aria-modal="true" aria-labelledby="connection-title"><div className="flex items-center justify-between"><h2 id="connection-title">Fonte da análise</h2><Button variant="ghost" size="icon" aria-label="Fechar" onClick={() => setConnectionOpen(false)}><X /></Button></div><p>Use a demonstração de Campo Mourão ou conecte sua API Node.js. A API deve aceitar a análise de talhão e permitir acesso pelo navegador. Não inclua chaves privadas no endereço.</p><form onSubmit={saveConnection}><label htmlFor="backend-url" className="form-label">Endereço da API Node.js</label><input id="backend-url" type="url" className="select-control" placeholder="https://sua-api.com.br" value={urlDraft} onChange={e => setUrlDraft(e.target.value)} required />{urlError && <p role="alert">{urlError}</p>}<div className="dialog-actions"><Button type="button" variant="outline" onClick={() => { setBackendUrl(''); setConnectionOpen(false); }}>Modo Demo</Button><Button type="submit">Conectar API Node.js</Button></div></form></section></div>}
  </>;
}
