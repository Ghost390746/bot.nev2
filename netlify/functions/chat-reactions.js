import { supabase, verifySession } from './_auth.js';

export async function handler(event) {
  const { session_token, message_id, reaction } = JSON.parse(event.body);
  const user_id = await verifySession(session_token);

  if (!message_id || !reaction) {
    return { statusCode: 400, body: 'Message ID and reaction required' };
  }

  const { error } = await supabase
    .from('message_reactions')
    .upsert({ message_id, user_id, reaction }, { onConflict: ['message_id', 'user_id'] });

  if (error) {
    return { statusCode: 500, body: error.message };
  }

  return { statusCode: 200, body: 'Reaction recorded' };
}
