/**
 * Teste de Integração Oficial com o Front-end (heitor1240/screenshot-exact)
 * Usa exatamente o payload FieldRequest de src/lib/field.ts e valida a resposta
 * com a mesma função isAnalysis() de src/services/agroShieldApi.ts!
 */

const { app } = require('./server');

// Cópia exata da função validadora isAnalysis() do Front-end (src/services/agroShieldApi.ts linhas 37-44)
function isAnalysisFrontEndValidator(value) {
  if (!value || typeof value !== 'object') return false;
  const v = value;
  return (
    ['red', 'yellow', 'green'].includes(String(v['risk'])) &&
    ['historicalRain', 'predictedRain', 'soilMoisture'].every(
      (k) => typeof v[k] === 'number' && Number.isFinite(v[k]) && Number(v[k]) >= 0
    ) &&
    typeof v['guidance'] === 'string' &&
    typeof v['technicalReason'] === 'string' &&
    Array.isArray(v['actions']) &&
    v['actions'].length === 3 &&
    v['actions'].every((a) => typeof a === 'string')
  );
}

async function testarIntegracaoComFrontEnd() {
  const server = app.listen(0, async () => {
    const port = server.address().port;
    console.log(`\n🧪 [TESTE FRONT-END] Servidor rodando na porta ${port}...`);

    // Payload idêntico ao gerado quando o usuário clica em "Usar Talhão de Exemplo" + "Ativar Vigia Espacial NASA" no Front-end
    const payloadFrontEnd = {
      polygon: [
        [-24.0357, -52.4038],
        [-24.0351, -52.3982],
        [-24.0398, -52.3976],
        [-24.0404, -52.4032],
      ],
      centroid: { lat: -24.03775, lng: -52.4007 },
      areaHectares: 29.8,
      crop: 'Soja',
      currentRotation: 'Soja → Milho Safrinha',
    };

    try {
      const response = await fetch(`http://localhost:${port}/api/analyze-field`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadFrontEnd),
      });

      const result = await response.json();
      const passouNoValidadorDoFront = isAnalysisFrontEndValidator(result);

      console.log(`\n📡 Status HTTP: ${response.status}`);
      console.log(
        `✅ Passou no validador estrito isAnalysis() do Front-end? ${
          passouNoValidadorDoFront ? 'SIM (100% COMPATÍVEL!)' : 'NÃO ❌'
        }`
      );
      console.log('\n📦 JSON Retornado para o Dashboard do Front-end:');
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error('❌ Erro no teste:', err);
    } finally {
      server.close(() => process.exit(0));
    }
  });
}

testarIntegracaoComFrontEnd();
