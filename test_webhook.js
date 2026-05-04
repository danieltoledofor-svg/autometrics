const fetch = require('node-fetch');
async function test() {
  const url = 'https://autometrics.cloud/api/webhook/google-ads';
  const payload = {
    user_id: 'test_user',
    campaign_name: 'Test Campaign',
    campaign_id: '123456',
    date: '2026-05-04',
    account_name: 'Test Account',
    mcc_name: 'Test MCC',
    currency_code: 'BRL',
    metrics: { impressions: 1, clicks: 1, cost_micros: 1000000 }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  console.log('Status:', res.status);
  console.log('Body:', await res.text());
}
test();
