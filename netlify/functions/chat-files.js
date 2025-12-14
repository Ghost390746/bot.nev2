import { supabase, verifySession } from './_auth.js';

export async function handler(event) {
  const { session_token, conversation_id, file_url, file_name } = JSON.parse(event.body);
  const user_id = await verifySession(session_token);

  if (!conversation_id || !file_url || !file_name) {
    return { statusCode: 400, body: 'All fields required' };
  }

  const { error } = await supabase
    .from('chat_files')
    .insert([{ conversation_id, user_id, file_url, file_name }]);

  if (error) {
    return { statusCode: 500, body: error.message };
  }

  return { statusCode: 200, body: 'File uploaded' };
}
