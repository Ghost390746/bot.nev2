import { supabase, verifySession } from './_auth.js';

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { session_token, title, user_ids } = JSON.parse(event.body || '{}');

    if (!session_token) return { statusCode: 401, body: 'Missing session token' };
    if (!Array.isArray(user_ids) || user_ids.length < 2) {
      return { statusCode: 400, body: 'Need at least 2 users' };
    }

    const creator_id = await verifySession(session_token);

    // Monthly limit check
    const start = new Date();
    start.setDate(1);
    const { count, error: countError } = await supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', start.toISOString());

    if (countError) throw countError;
    if (count >= 100) return { statusCode: 403, body: 'Monthly chat limit reached' };

    const is_group = user_ids.length > 2;

    // Create conversation
    const { data: convo, error: convoError } = await supabase
      .from('conversations')
      .insert([{ title: title || null, is_group, owner_id: creator_id }])
      .select()
      .single();

    if (convoError) throw convoError;

    // Add members
    const members = [...new Set([creator_id, ...user_ids])].map(id => ({
      conversation_id: convo.id,
      user_id: id,
      role: id === creator_id ? 'admin' : 'member',
    }));

    const { error: membersError } = await supabase
      .from('conversation_members')
      .insert(members);

    if (membersError) throw membersError;

    return { statusCode: 200, body: JSON.stringify(convo) };

  } catch (e) {
    return { statusCode: 401, body: e.message || 'Unauthorized' };
  }
}
