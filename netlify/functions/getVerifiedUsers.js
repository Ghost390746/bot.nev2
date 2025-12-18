// netlify/functions/getVerifiedUsers.js
import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';

// Use SERVICE_KEY if you need secure reads/writes
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  try {
    // 🍪 Read cookies safely
    const cookies = cookie.parse(event.headers.cookie || '');
    
    // ✅ Match the actual login cookie names
    const session_token = cookies['__Host-session_secure'] || cookies['session_token'];

    if (!session_token) {
      return {
        statusCode: 401,
        body: JSON.stringify({ success: false, error: 'Not authenticated' })
      };
    }

    // 🔐 Verify session
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('user_email, expires_at')
      .eq('session_token', session_token)
      .maybeSingle(); // avoids crash if no session

    if (sessionError || !sessionData) {
      return {
        statusCode: 403,
        body: JSON.stringify({ success: false, error: 'Invalid session' })
      };
    }

    if (new Date(sessionData.expires_at) < new Date()) {
      return {
        statusCode: 403,
        body: JSON.stringify({ success: false, error: 'Session expired' })
      };
    }

    // ✅ Get all verified users excluding self
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('email')
      .eq('verified', true)
      .neq('email', sessionData.user_email)
      .order('email', { ascending: true });

    if (usersError) throw usersError;

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, users })
    };

  } catch (err) {
    console.error('getVerifiedUsers error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Internal server error', details: err.message })
    };
  }
};
