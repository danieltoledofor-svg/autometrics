const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const userId = 'd2c26964-d009-4396-9f8f-16f5a931c079';
  
  const { data: products } = await supabase.from('products').select('id').eq('user_id', userId);
  const productIds = products.map(p => p.id);
  
  // Try querying WITH limit 50000
  const { data: metrics, error, count } = await supabase
    .from('daily_metrics')
    .select('id')
    .in('product_id', productIds)
    .limit(50000);
    
  console.log('Metrics length returned by limit(50000):', metrics ? metrics.length : 'error');
  if (error) console.error(error);
}
main();
