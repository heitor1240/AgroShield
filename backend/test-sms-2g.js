/**
 * ============================================================================
 * 📲 TESTE REAL DO MÓDULO 2G OFFLINE SMS (TWILIO + NASA POWER + CLAUDE SONNET)
 * ============================================================================
 * Simula:
 * 1. Cadastro dos lotes do Seu Carlos (Lote Norte e Lote Baixada Sul) + Disparo automático de SMS quando entra em DANGER.
 * 2. Seu Carlos no trator (sem 3G/4G, só rede 2G) mandando SMS em texto livre:
 *    - Pergunta 1: "O céu fechou pro lado do Lote Norte. Tem risco de vento se eu aplicar o veneno agora?"
 *    - Pergunta 2: "Deu uma tempestade ontem à noite na Baixada Sul, será que o solo tá muito encharcado pro trator hoje?"
 *    - Pergunta 3: Webhook nativo do Twilio (application/x-www-form-urlencoded) retornando XML TwiML oficial.
 */

const { app } = require('./server');

async function testarFluxoSms2G() {
  const server = app.listen(0, async () => {
    const port = server.address().port;
    const baseUrl = `http://localhost:${port}`;

    console.log(`\n📡 [TESTE 2G OFFLINE SMS] Servidor iniciado na porta ${port}...`);

    try {
      // ----------------------------------------------------------------------
      // PASSO 1: Agricultor cadastra Lote Norte e Lote Baixada Sul na sede (com Wi-Fi)
      // ----------------------------------------------------------------------
      console.log('\n================================================================================');
      console.log('1️⃣  PASSO 1: Seu Carlos mapeia Lote Norte e Lote Baixada Sul (Disparo Ativo 2G)');
      console.log('================================================================================');

      const resCadastro = await fetch(`${baseUrl}/api/analyze-risk-multi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telefone_produtor: '+5544998765432',
          lotes: [
            {
              nome_lote: 'Lote Norte',
              cultura: 'Soja',
              area_geojson: {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [-52.365, -24.03],
                      [-52.355, -24.03],
                      [-52.355, -24.02],
                      [-52.365, -24.02],
                      [-52.365, -24.03],
                    ],
                  ],
                },
              },
            },
            {
              nome_lote: 'Lote Baixada Sul',
              cultura: 'Milho Safrinha',
              simular_clima: {
                media_historica_mensal: 50,
                pico_chuva_atual: 135,
                pico_vento_atual: 5.2,
              },
              area_geojson: {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [-52.385, -24.06],
                      [-52.375, -24.06],
                      [-52.375, -24.05],
                      [-52.385, -24.05],
                      [-52.385, -24.06],
                    ],
                  ],
                },
              },
            },
          ],
        }),
      });

      const dataCadastro = await resCadastro.json();
      console.log('📲 Alerta Automático Disparado por Status DANGER:');
      console.log(JSON.stringify(dataCadastro.contingencia_sms_2g, null, 2));

      // ----------------------------------------------------------------------
      // PASSO 2: Seu Carlos está no trator SEM INTERNET e manda SMS em linguagem natural
      // ----------------------------------------------------------------------
      console.log('\n================================================================================');
      console.log('2️⃣  PASSO 2: Consulta Bidirecional via SMS 2G (Dúvida de Pulverização / Vento)');
      console.log('================================================================================');

      const resSms1 = await fetch(`${baseUrl}/api/sms-responder?format=json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          From: '+5544998765432',
          Body: 'O céu fechou pro lado do Lote Norte. Tem risco de vento se eu aplicar o veneno agora?',
          simular_clima: {
            media_historica_mensal: 50.6,
            pico_chuva_atual: 14.0,
            pico_vento_atual: 5.0, // Vento a 5m/s detectado pelo satélite!
          },
        }),
      });

      const dataSms1 = await resSms1.json();
      console.log(`👨‍🌾 SMS Enviado pelo Agricultor : "${dataSms1.pergunta_agricultor}"`);
      console.log(`📍 Lote Identificado no Banco   : ${dataSms1.lotes_consultados?.[0]?.nome_lote}`);
      console.log(`📩 SMS Recebido no Trator (${dataSms1.caracteres} chars):`);
      console.log(`   👉 "${dataSms1.resposta_sms}"`);

      // ----------------------------------------------------------------------
      // PASSO 3: Outra pergunta em linguagem natural (Solo encharcado / Trator)
      // ----------------------------------------------------------------------
      console.log('\n================================================================================');
      console.log('3️⃣  PASSO 3: Consulta Bidirecional via SMS 2G (Dúvida sobre Solo Encharcado)');
      console.log('================================================================================');

      const resSms2 = await fetch(`${baseUrl}/api/sms-responder?format=json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          From: '+5544998765432',
          Body: 'Deu uma tempestade ontem à noite no Lote Baixada Sul, será que o solo tá muito encharcado pro trator hoje?',
          simular_clima: {
            media_historica_mensal: 50.0,
            pico_chuva_atual: 118.0, // 118mm acumulados!
            pico_vento_atual: 3.1,
          },
        }),
      });

      const dataSms2 = await resSms2.json();
      console.log(`👨‍🌾 SMS Enviado pelo Agricultor : "${dataSms2.pergunta_agricultor}"`);
      console.log(`📍 Lote Identificado no Banco   : ${dataSms2.lotes_consultados?.[0]?.nome_lote}`);
      console.log(`📩 SMS Recebido no Trator (${dataSms2.caracteres} chars):`);
      console.log(`   👉 "${dataSms2.resposta_sms}"`);

      // ----------------------------------------------------------------------
      // PASSO 4: Simulação Exata do Webhook Oficial do Twilio (x-www-form-urlencoded -> XML TwiML)
      // ----------------------------------------------------------------------
      console.log('\n================================================================================');
      console.log('4️⃣  PASSO 4: Teste do Webhook Nativo Twilio (Form-UrlEncoded -> Retorno XML TwiML)');
      console.log('================================================================================');

      const formTwilio = new URLSearchParams({
        From: '+5544998765432',
        Body: 'Posso entrar pulverizando soja no Lote Norte agora de manha?',
      });

      const resTwiml = await fetch(`${baseUrl}/api/sms-responder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formTwilio.toString(),
      });

      const xmlTwiml = await resTwiml.text();
      console.log(`📡 Content-Type Retornado ao Twilio: ${resTwiml.headers.get('content-type')}`);
      console.log(`📄 Payload TwiML Oficial (Consulta NASA POWER Ao Vivo em Campo Mourão):`);
      console.log(xmlTwiml);
      console.log('================================================================================\n');
    } catch (err) {
      console.error('❌ Erro no teste 2G:', err);
    } finally {
      server.close(() => process.exit(0));
    }
  });
}

testarFluxoSms2G();
