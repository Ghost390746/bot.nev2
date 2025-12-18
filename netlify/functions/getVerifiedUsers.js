import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  try {
    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token = cookies.session_token;

    if (!session_token) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'No session cookie found' }) };
    }

    const { data: sessionData } = await supabase
      .from('sessions')
      .select('*')
      .eq('session_token', session_token)
      .maybeSingle();

    if (!sessionData) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Invalid session' }) };
    }

    const { data: users, error } = await supabase
      .from('users')
      .select('email')
      .eq('verified', true)
      .neq('email', sessionData.user_email)
      .order('email', { ascending: true });

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ success: true, users }) };

  } catch (err) {
    console.error('getVerifiedUsers error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error' }) };
  }
};
