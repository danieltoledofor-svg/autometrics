const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data: logs, error } = await supabase
    .from('webhook_logs') // or postback_logs? Let's check which table is used.
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);
    
  if (error) console.log("Error webhook_logs:", error.message);
  else console.log("Recent webhook_logs:", JSON.stringify(logs, null, 2));

  const { data: postbacks, error: err3 } = await supabase
    .from('postback_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  if (err3) console.log("Error postback_logs:", err3.message);
  else console.log("Recent postback_logs:", JSON.stringify(postbacks, null, 2));

  const { data: metrics, error: err2 } = await supabase
    .from('daily_metrics')
    .select('id, date, campaign_id, checkouts, sales, revenue, profit')
    .eq('user_id', '4f55cefe-055c-46b1-a660-9376e7cfee65')
    .order('date', { ascending: false })
    .limit(5);
    
  if (err2) console.log("Error daily_metrics:", err2.message);
  else console.log("Recent daily_metrics:", JSON.stringify(metrics, null, 2));
}
main();
