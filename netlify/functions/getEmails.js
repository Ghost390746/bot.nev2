import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': 'https://botnet2.netlify.app/email?ref=@dude', // replace with your frontend
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

  try {
    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token = cookies.session_token;
    if (!session_token) return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'No session cookie' }) };

    const { data: session } = await supabase.from('sessions').select('user_email, expires_at').eq('session_token', session_token).maybeSingle();
    if (!session) return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Invalid session' }) };
    if (new Date(session.expires_at) < new Date()) return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Session expired' }) };

    const { data: emails, error } = await supabase
      .from('emails')
      .select('*')
      .eq('to_user', session.user_email)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, emails }) };

  } catch (err) {
    console.error('getEmails error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Server error' }) };
  }
};
