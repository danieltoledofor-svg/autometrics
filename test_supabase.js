const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

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
    .select('*, products!inner(id, user_id)')
    .eq('products.user_id', 'e74659f8-7db1-4cbb-b2d9-1ab039e10882') // example
    .limit(10);
    
  console.log("Error:", error?.message);
  console.log("Data count:", data ? data.length : 0);
}
check();
