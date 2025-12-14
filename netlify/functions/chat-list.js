import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  const user_id = event.queryStringParameters.user_id;

  const { data, error } = await supabase
    .from('conversation_members')
    .select(`
      conversation_id,
      conversations ( title, is_group )
    `)
    .eq('user_id', user_id);

  if (error) {
    return { statusCode: 500, body: error.message };
  }

  return { statusCode: 200, body: JSON.stringify(data) };
}
