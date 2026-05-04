const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const [key, ...val] = line.split('=');
  if (key && val.length) acc[key.trim()] = val.join('=').trim().replace(/^"|"$/g, '');
  return acc;
}, {});

async function main() {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sql`, {
    method: 'POST',
    headers: { 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'CREATE TABLE IF NOT EXISTS raw_postbacks (id SERIAL PRIMARY KEY, url TEXT, created_at TIMESTAMP DEFAULT NOW());' })
  });
  console.log(await res.text());
}
main();
