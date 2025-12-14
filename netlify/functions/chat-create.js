import { supabase, verifySession } from './_auth.js';

export async function handler(event) {
  try {
    const { session_token, title, user_ids } = JSON.parse(event.body);
    const creator_id = await verifySession(session_token);

    if (!Array.isArray(user_ids) || user_ids.length < 2) {
      return { statusCode: 400, body: 'Need at least 2 users' };
    }

    // Monthly limit
    const start = new Date();
    start.setDate(1);

    const { count } = await supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', start.toISOString());

    if (count >= 100) {
      return { statusCode: 403, body: 'Monthly chat limit reached' };
    }

    const is_group = user_ids.length > 2;

    const { data: convo } = await supabase
      .from('conversations')
      .insert([{ title, is_group, owner_id: creator_id }])
      .select()
      .single();

    const members = [...new Set([creator_id, ...user_ids])].map(id => ({
      conversation_id: convo.id,
      user_id: id,
      role: id === creator_id ? 'admin' : 'member'
    }));

    await supabase.from('conversation_members').insert(members);

    return { statusCode: 200, body: JSON.stringify(convo) };

  } catch (e) {
    return { statusCode: 401, body: e.message };
  }
}
