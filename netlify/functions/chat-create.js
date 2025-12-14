import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  try {
    const { title, user_ids } = JSON.parse(event.body);

    if (!Array.isArray(user_ids) || user_ids.length < 2) {
      return { statusCode: 400, body: 'At least 2 users required' };
    }

    const is_group = user_ids.length > 2;

    const { data: convo, error } = await supabase
      .from('conversations')
      .insert([{ title, is_group }])
      .select()
      .single();

    if (error) throw error;

    const members = user_ids.map(uid => ({
      conversation_id: convo.id,
      user_id: uid
    }));

    await supabase.from('conversation_members').insert(members);

    return {
      statusCode: 200,
      body: JSON.stringify({ conversation_id: convo.id })
    };

  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
}
