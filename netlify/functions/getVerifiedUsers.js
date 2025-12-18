// netlify/functions/getVerifiedUsers.js
import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  try {
    // 🍪 Read session token from cookie
    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token = cookies.ion_token; // <-- must match your cookie

    if (!session_token) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not authenticated' }) };
    }

    // 🔐 Verify session
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('user_email')
      .eq('session_token', session_token)
      .single();

    if (sessionError || !sessionData) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Invalid session' }) };
    }

    // ✅ Get all verified users excluding self
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('email')
      .eq('verified', true)
      .neq('email', sessionData.user_email)
      .order('email', { ascending: true });

    if (usersError) throw usersError;

    return { statusCode: 200, body: JSON.stringify({ success: true, users }) };

  } catch (err) {
    console.error('getVerifiedUsers error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error', details: err.message }) };
  }
};
