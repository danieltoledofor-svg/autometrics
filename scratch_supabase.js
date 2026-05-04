const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const [key, ...val] = line.split('=');
  if (key && val.length) acc[key.trim()] = val.join('=').trim().replace(/^"|"$/g, '');
  return acc;
}, {});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function main() {
  // We want to see if the user has any recent postbacks in postback_events
  const res = await fetch(`${supabaseUrl}/rest/v1/postback_events?select=*&order=created_at.desc&limit=5`, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  console.log("Recent Postbacks:", await res.json());

  // Let's also fetch daily_metrics for today
  const res2 = await fetch(`${supabaseUrl}/rest/v1/daily_metrics?user_id=eq.4f55cefe-055c-46b1-a660-9376e7cfee65&order=date.desc&limit=5`, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
  });
  console.log("Recent Metrics:", await res2.json());
}
main();
