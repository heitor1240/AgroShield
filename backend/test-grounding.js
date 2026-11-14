// Teste do Grounding Regional: PR ao vivo, PR tempestade (45mm / 12 km/h) e BA (MATOPIBA)
const server = require('./server');
const { app } = server;

const regiaoMod = require('./server');

function isAnalysis(v) {
  return v && ['red', 'yellow', 'green'].includes(String(v.risk)) &&
    ['historicalRain', 'predictedRain', 'soilMoisture'].every((k) => typeof v[k] === 'number' && Number.isFinite(v[k]) && v[k] >= 0) &&
    typeof v.guidance === 'string' && typeof v.technicalReason === 'string' &&
    Array.isArray(v.actions) && v.actions.length === 3 && v.actions.every((a) => typeof a === 'string');
}

const quadrado = (lat, lng) => [[lat, lng], [lat, lng + 0.005], [lat - 0.005, lng + 0.005], [lat - 0.005, lng]];

const cenarios = [
  { titulo: 'PR · Soja · NASA ao vivo (Campo Mourão)', body: { polygon: quadrado(-24.0357, -52.4038), centroid: { lat: -24.03775, lng: -52.4007 }, areaHectares: 30.1, crop: 'Soja', currentRotation: 'Soja → Milho Safrinha' } },
  { titulo: 'BA · Soja · NASA ao vivo (Luís Eduardo Magalhães)', body: { polygon: quadrado(-12.09, -45.79), centroid: { lat: -12.0925, lng: -45.7875 }, areaHectares: 30, crop: 'Soja', currentRotation: 'Monocultura de Soja' } },
];

app.listen(0, async function () {
  const port = this.address().port;
  for (const c of cenarios) {
    const t0 = Date.now();
    const r = await fetch(`http://localhost:${port}/api/analyze-field`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c.body) });
    const j = await r.json();
    console.log(`\n================ ${c.titulo} (${Date.now() - t0} ms)`);
    console.log(`isAnalysis() do front: ${isAnalysis(j) ? 'OK' : 'FALHOU'} | risk: ${j.risk} | chuva ${j.predictedRain} mm | umidade ${j.soilMoisture}%`);
    console.log(`guidance: ${j.guidance}`);
    console.log(`technicalReason: ${j.technicalReason}`);
  }
  // Cenário do pitch: NASA diz 45mm e 12 km/h em Campo Mourão (Soja)
  const { obterDiretrizRegional, calcularPisoFisicoRegional, gerarAnaliseComClaude } = server;
  const fieldReq = { ...cenarios[0].body };
  fieldReq.regiao = obterDiretrizRegional(fieldReq.centroid.lat, fieldReq.centroid.lng, 'Soja');
  const nasaFake = { historicalRain: 51, predictedRain: 45, soilMoisture: 72, windSpeed2m: Number((12 / 3.6).toFixed(2)) };
  const nasaMetrics = { ...nasaFake, ...calcularPisoFisicoRegional(nasaFake, fieldReq.regiao.limites) };
  const t0 = Date.now();
  const j = await gerarAnaliseComClaude(fieldReq, nasaMetrics);
  console.log(`\n================ PR · Soja · TEMPESTADE SIMULADA 45mm / 12 km/h (${Date.now() - t0} ms)`);
  console.log(`piso físico do código: ${nasaMetrics.minPhysicalRisk} | isAnalysis(): ${isAnalysis(j) ? 'OK' : 'FALHOU'} | risk final: ${j.risk}`);
  console.log(`guidance: ${j.guidance}`);
  console.log(`technicalReason: ${j.technicalReason}`);
  process.exit(0);
});
