import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  try {
    const { conversation_id, sender_id, content } = JSON.parse(event.body);

    if (!conversation_id || !sender_id || !content) {
      return { statusCode: 400, body: 'Missing data' };
    }

    const { error } = await supabase
      .from('messages')
      .insert([{ conversation_id, sender_id, content }]);

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
}
