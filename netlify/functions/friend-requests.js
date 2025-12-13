import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { action, sender_email, receiver_email, request_id, status } = JSON.parse(event.body);

    if (action === 'send') {
      if (!sender_email || !receiver_email) return { statusCode: 400, body: JSON.stringify({ error: 'Missing emails.' }) };
      const { data, error } = await supabase
        .from('friend_requests')
        .insert({ id: uuidv4(), sender_email, receiver_email, status: 'pending' })
        .select()
        .single();
      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify({ success: true, request: data }) };
    }

    if (action === 'respond') {
      if (!request_id || !status) return { statusCode: 400, body: JSON.stringify({ error: 'Missing request_id or status.' }) };
      const { data, error } = await supabase
        .from('friend_requests')
        .update({ status })
        .eq('id', request_id)
        .select()
        .single();
      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify({ success: true, request: data }) };
    }

    if (action === 'list-incoming') {
      if (!receiver_email) return { statusCode: 400, body: JSON.stringify({ error: 'Missing receiver_email.' }) };
      const { data, error } = await supabase
        .from('friend_requests')
        .select('*')
        .eq('receiver_email', receiver_email)
        .eq('status', 'pending');
      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify({ success: true, requests: data }) };
    }

    if (action === 'get-profile') {
      if (!receiver_email) return { statusCode: 400, body: JSON.stringify({ error: 'Missing email.' }) };
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', receiver_email)
        .single();
      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify({ success: true, user: data }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid action.' }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Friend request operation failed.' }) };
  }
};
