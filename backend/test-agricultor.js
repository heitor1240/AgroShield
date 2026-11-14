/**
 * ============================================================================
 * 👨‍🌾 BATERIA DE TESTES E2E: "DIA DE CAMPO DO AGRICULTOR" (AGROSHIELD)
 * ============================================================================
 */

const { app } = require('./server');

const ICONE_SEMAFORO = {
  danger: '🔴 PERIGO (DANGER)',
  warning: '🟡 ATENÇÃO (WARNING)',
  success: '🟢 SEGURO (SUCCESS)',
};

function imprimirRelatorioAgricultor(tituloCenario, statusHttp, resposta) {
  console.log('\n================================================================================');
  console.log(`🚜 ${tituloCenario}`);
  console.log('================================================================================');
  console.log(`📡 Status HTTP: ${statusHttp}`);
  console.log(`🚦 SEMÁFORO GERAL DA FAZENDA: ${ICONE_SEMAFORO[resposta.fazenda_status_geral] || resposta.fazenda_status_geral}`);
  console.log('--------------------------------------------------------------------------------');

  if (Array.isArray(resposta.analise_lotes)) {
    resposta.analise_lotes.forEach((lote, i) => {
      console.log(`  📍 Lote #${i + 1}: ${lote.nome_lote} (${lote.cultura || 'Cultura'})`);
      if (lote.coordenadas) {
        console.log(`     🌎 Centroide (@turf): Lat ${lote.coordenadas.latitude}, Lng ${lote.coordenadas.longitude}`);
      }
      console.log(`     🚦 Alerta do Lote   : ${ICONE_SEMAFORO[lote.status_alerta] || lote.status_alerta}`);
      console.log(`     🗣️ Ordem do Copiloto: "${lote.recomendacao_ia}"`);
      console.log(`     🛰️ Prova NASA POWER : "${lote.justificativa_fonte}"`);
      console.log(
        `     📊 Gráfico Front-end: ${lote.dados_grafico?.labels?.[0]}=${lote.dados_grafico?.valores?.[0]}mm vs ${lote.dados_grafico?.labels?.[1]}=${lote.dados_grafico?.valores?.[1]}mm`
      );
      console.log('--------------------------------------------------------------------------------');
    });
  }
}

async function executarBateriaAgricultor() {
  const server = app.listen(0, async () => {
    const port = server.address().port;
    const baseUrl = `http://localhost:${port}`;

    console.log(`\n🌾 INICIANDO BATERIA DE TESTES DO AGRICULTOR NA PORTA ${port}...`);

    try {
      // CENÁRIO 1: Cooperado em Campo Mourão consultando 2 lotes REAIS na NASA
      const res1 = await fetch(`${baseUrl}/api/analyze-risk-multi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lotes: [
            {
              nome_lote: 'Talhão 01 - Sede (Campo Mourão)',
              cultura: 'Soja Intacta',
              area_geojson: {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [-52.385, -24.05],
                      [-52.375, -24.05],
                      [-52.375, -24.04],
                      [-52.385, -24.04],
                      [-52.385, -24.05],
                    ],
                  ],
                },
              },
            },
            {
              nome_lote: 'Talhão 02 - Encosta Rio do Campo',
              cultura: 'Milho Safrinha',
              area_geojson: {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [-52.345, -24.03],
                      [-52.335, -24.03],
                      [-52.335, -24.02],
                      [-52.345, -24.02],
                      [-52.345, -24.03],
                    ],
                  ],
                },
              },
            },
          ],
        }),
      });
      imprimirRelatorioAgricultor(
        'CENÁRIO 1: Consulta Real de Satélite em Campo Mourão (NASA POWER Live)',
        res1.status,
        await res1.json()
      );

      // CENÁRIO 2: Dia Seco, mas com Ventania Forte (Agricultor querendo pulverizar)
      const res2 = await fetch(`${baseUrl}/api/analyze-risk-multi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lotes: [
            {
              nome_lote: 'Talhão Divisa Vizinho (Pulverização Fungicida)',
              cultura: 'Soja',
              simular_clima: {
                media_historica_mensal: 50.6,
                pico_chuva_atual: 12.0,
                pico_vento_atual: 4.6,
              },
              area_geojson: {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [-52.4, -24.06],
                      [-52.39, -24.06],
                      [-52.39, -24.05],
                      [-52.4, -24.05],
                      [-52.4, -24.06],
                    ],
                  ],
                },
              },
            },
          ],
        }),
      });
      imprimirRelatorioAgricultor(
        'CENÁRIO 2: Agricultor tenta pulverizar com Vento Forte (WS2M = 4.6 m/s)',
        res2.status,
        await res2.json()
      );

      // CENÁRIO 3: Tempestade El Niño + Fazenda com 3 Realidades Diferentes
      const res3 = await fetch(`${baseUrl}/api/analyze-risk-multi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lotes: [
            {
              nome_lote: 'Lote Baixada Sul (Várzea)',
              cultura: 'Soja',
              simular_clima: {
                media_historica_mensal: 50,
                pico_chuva_atual: 140,
                pico_vento_atual: 5.4,
              },
              area_geojson: {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [-52.38, -24.08],
                      [-52.37, -24.08],
                      [-52.37, -24.07],
                      [-52.38, -24.07],
                      [-52.38, -24.08],
                    ],
                  ],
                },
              },
            },
            {
              nome_lote: 'Lote Chapada Alta (Vento Moderado)',
              cultura: 'Milho',
              simular_clima: {
                media_historica_mensal: 50,
                pico_chuva_atual: 18,
                pico_vento_atual: 3.8,
              },
              area_geojson: {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [-52.36, -24.01],
                      [-52.35, -24.01],
                      [-52.35, -24.0],
                      [-52.36, -24.0],
                      [-52.36, -24.01],
                    ],
                  ],
                },
              },
            },
            {
              nome_lote: 'Lote Protegido Mata (Estável)',
              cultura: 'Trigo',
              simular_clima: {
                media_historica_mensal: 45,
                pico_chuva_atual: 20,
                pico_vento_atual: 1.9,
              },
              area_geojson: {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [-52.32, -24.02],
                      [-52.31, -24.02],
                      [-52.31, -24.01],
                      [-52.32, -24.01],
                      [-52.32, -24.02],
                    ],
                  ],
                },
              },
            },
          ],
        }),
      });
      imprimirRelatorioAgricultor(
        'CENÁRIO 3: Fazenda Mista durante El Niño (1 🔴 Perigo + 1 🟡 Atenção + 1 🟢 Seguro)',
        res3.status,
        await res3.json()
      );

      // CENÁRIO 4: Teste Anti-Crash (GeoJSON quebrado)
      const res4 = await fetch(`${baseUrl}/api/analyze-risk-multi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lotes: [
            {
              nome_lote: 'Lote Desenhado Errado no 3G da Roça',
              cultura: 'Café',
              area_geojson: { PoligonoCorrompido: 'sem_coordenadas' },
            },
          ],
        }),
      });
      imprimirRelatorioAgricultor(
        'CENÁRIO 4: Teste Anti-Crash (Agricultor com 3G ruim enviou GeoJSON corrompido)',
        res4.status,
        await res4.json()
      );

      // CENÁRIO 5: Agricultor consultando o Histórico Salvo (GET /api/history)
      const resHist = await fetch(`${baseUrl}/api/history`);
      const jsonHist = await resHist.json();
      console.log('\n================================================================================');
      console.log('🗄️  CENÁRIO 5: AGRICULTOR ABRE O HISTÓRICO DE TALHÕES SALVOS (GET /api/history)');
      console.log('================================================================================');
      console.log(`📦 Fonte de Persistência : ${jsonHist.fonte_banco}`);
      console.log(`📊 Total de Lotes Salvos : ${jsonHist.total}`);
      console.log(
        `📋 Últimos Lotes Gravados: ${jsonHist.historico
          .map((h) => `${h.nome_lote} [${h.resultado_ia?.status_alerta?.toUpperCase()}]`)
          .join(' | ')}`
      );
      console.log('================================================================================\n');
    } catch (err) {
      console.error('❌ Falha inesperada na bateria:', err);
    } finally {
      server.close(() => process.exit(0));
    }
  });
}

executarBateriaAgricultor();
