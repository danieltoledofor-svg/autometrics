const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data, error } = await supabase.from('user_settings').select('user_id, vturb_api_token').not('vturb_api_token', 'is', null).limit(1);
  if (error) console.error(error);
  else console.log("Token:", data[0]?.vturb_api_token);
}
run();
