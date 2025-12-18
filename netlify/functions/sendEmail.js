import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export const handler = async (event) => {
  try {
    const { session_token, to_user, subject, body } = JSON.parse(event.body || '{}');

    if (!session_token || !to_user || !body) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing required fields' }) };
    }

    // 🔐 Verify session and get sender email
    const { data: sessionData } = await supabase
      .from('sessions')
      .select('*')
      .eq('session_token', session_token)
      .single();

    if (!sessionData) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Invalid session' }) };
    }

    const from_user = sessionData.user_email;

    // ✅ Check sender is verified
    const { data: sender } = await supabase
      .from('users')
      .select('*')
      .eq('email', from_user)
      .eq('verified', true)
      .single();

    if (!sender) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Sender not verified' }) };
    }

    // ✅ Check recipient exists and is verified
    const { data: recipient } = await supabase
      .from('users')
      .select('*')
      .eq('email', to_user)
      .eq('verified', true)
      .single();

    if (!recipient) {
      return { statusCode: 404, body: JSON.stringify({ success: false, error: 'Recipient not found or not verified' }) };
    }

    // 🔐 Insert into emails table
    await supabase.from('emails').insert({
      id: uuidv4(),
      from_user,
      to_user,
      subject: subject || '',
      body
    });

    return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Email sent successfully!' }) };

  } catch (err) {
    console.error('SendEmail error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error' }) };
  }
};
