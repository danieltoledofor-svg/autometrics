// Este script simula o Google Ads enviando dados para o seu site
async function testWebhook() {
    console.log('🚀 Iniciando teste de integração...');
  
    // Dados falsos simulando uma campanha real
    const payload = {
      campaign_name: '[FF] EPICOOLER 85', // Nome exato que está no Banco de Dados
      date: new Date().toISOString().split('T')[0], // Data de hoje
      metrics: {
        impressions: 1500,
        clicks: 80,
        cost_micros: 25000000, // Equivale a 25.00 (x 1 milhão)
        ctr: '5.33%',
        average_cpc: 312500,   // Equivale a 0.31
        search_impression_share: '45.5%',
        search_top_impression_share: '20.1%'
      }
    };
  
    try {
      const response = await fetch('http://localhost:3000/api/webhook/google-ads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
  
      console.log(`📡 Status da Resposta: ${response.status} ${response.statusText}`);
  
      // Tenta ler como texto primeiro para evitar o erro de JSON
      const text = await response.text();
      
      let result;
      try {
        result = text ? JSON.parse(text) : null;
      } catch (e) {
        console.error('⚠️ A resposta não é um JSON válido.');
        console.error('Conteúdo bruto:', text);
        return;
      }
  
      if (response.ok) {
        console.log('✅ SUCESSO! O servidor aceitou os dados.');
        console.log('Resposta:', result);
      } else {
        console.error('❌ ERRO! O servidor rejeitou.');
        console.error('Status:', response.status);
        console.error('Detalhe:', result);
      }
    } catch (error) {
      console.error('❌ Falha na conexão. Verifique se o servidor está rodando em outro terminal (npm run dev).');
      console.error('Erro técnico:', error.cause || error.message);
    }
  }
  
  testWebhook();