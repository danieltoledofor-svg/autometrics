const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Simple parse of .env.local
const envFile = fs.readFileSync('.env.local', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const [key, ...val] = line.split('=');
  if (key && val) env[key.trim()] = val.join('=').trim();
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data, error } = await supabase
    .from('daily_metrics')
    .select('date, updated_at, product_id, account_name')
    .order('updated_at', { ascending: false })
    .limit(10);
  
  if (error) console.error("Error fetching metrics:", error);
  else console.log("Recent Metrics:", data);

  const { data: pData, error: pError } = await supabase
    .from('products')
    .select('id, name')
    .order('created_at', { ascending: false })
    .limit(5);

  if (pError) console.error("Error fetching products:", pError);
  else console.log("Recent Products:", pData);
}
check();
