import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export async function checkRateLimit(ip) {
  const windowMinutes = 10;
  const maxAttempts = 5;

  const since = new Date(Date.now() - windowMinutes * 60 * 1000);

  const { data } = await supabase
    .from('login_attempts')
    .select('id')
    .eq('ip', ip)
    .gte('created_at', since.toISOString());

  return data.length < maxAttempts;
}

export async function logAttempt(ip) {
  await supabase.from('login_attempts').insert({ ip });
}
