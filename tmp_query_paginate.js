const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const userId = 'd2c26964-d009-4396-9f8f-16f5a931c079';
  const { data: products } = await supabase.from('products').select('id').eq('user_id', userId);
  const productIds = products.map(p => p.id);
  
  let allMetrics = [];
  let page = 0;
  let hasMore = true;
  while(hasMore) {
     const { data: chunk, error } = await supabase
        .from('daily_metrics')
        .select('*')
        .in('product_id', productIds)
        .range(page * 1000, (page + 1) * 1000 - 1)
        .order('date', { ascending: false });
     
     if (error) {
       console.error(error);
       break;
     }
     
     if (chunk && chunk.length > 0) {
        allMetrics.push(...chunk);
        if (chunk.length < 1000) hasMore = false;
        else page++;
     } else {
        hasMore = false;
     }
  }
  
  console.log('Total metrics fetched via pagination:', allMetrics.length);
}
main();
