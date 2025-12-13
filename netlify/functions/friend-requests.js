import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { action, sender_email, receiver_email } = JSON.parse(event.body);

    if (!action || !sender_email || !receiver_email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields.' }) };
    }

    if (action === 'send') {
      const { data, error } = await supabase
        .from('friend_requests')
        .insert({ id: uuidv4(), sender_email, receiver_email, status: 'pending' })
        .select()
        .single();
      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify({ success: true, request: data }) };
    }

    if (action === 'respond') {
      const { status, request_id } = JSON.parse(event.body);
      if (!status || !request_id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing status or request_id.' }) };

      const { data, error } = await supabase
        .from('friend_requests')
        .update({ status })
        .eq('id', request_id)
        .select()
        .single();
      if (error) throw error;

      return { statusCode: 200, body: JSON.stringify({ success: true, request: data }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid action.' }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Friend request operation failed.' }) };
  }
};
