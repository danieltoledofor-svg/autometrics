require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function checkTables() {
  const tables = ['search_terms', 'audiences', 'locations', 'campaign_strategies', 'campaign_history'];
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('id').limit(1);
    console.log(`Table ${table}: `, error ? error.message : 'Exists');
  }
}

checkTables();
