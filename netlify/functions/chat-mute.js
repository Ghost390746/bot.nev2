// /.netlify/functions/chat-mute.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { session_token, conversation_id } = JSON.parse(event.body);

    if (!session_token || !conversation_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing parameters' }) };
    }

    // 1️⃣ Get user ID from session token
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('session_token', session_token)
      .single();

    if (userError || !userData) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid session token' }) };
    }

    const user_id = userData.id;

    // 2️⃣ Check if chat is already muted
    const { data: existing } = await supabase
      .from('muted_chats')
      .select('id')
      .eq('user_id', user_id)
      .eq('conversation_id', conversation_id)
      .single();

    if (existing) {
      // If already muted, unmute
      const { error: unmuteError } = await supabase
        .from('muted_chats')
        .delete()
        .eq('id', existing.id);

      if (unmuteError) throw unmuteError;

      return { statusCode: 200, body: JSON.stringify({ success: true, muted: false }) };
    }

    // 3️⃣ Insert mute record
    const { error: insertError } = await supabase
      .from('muted_chats')
      .insert([{ user_id, conversation_id }]);

    if (insertError) throw insertError;

    return { statusCode: 200, body: JSON.stringify({ success: true, muted: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
