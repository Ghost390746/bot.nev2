import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';

// Service role key for secure backend access
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        body: JSON.stringify({ success: false, error: 'Method not allowed' })
      };
    }

    // ✅ Safely parse cookies (Netlify-compatible)
    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token = cookies.session_token;

    if (!session_token) {
      return {
        statusCode: 401,
        body: JSON.stringify({ success: false, error: 'Not authenticated' })
      };
    }

    // ✅ Verify session
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('user_email, expires_at')
      .eq('session_token', session_token)
      .maybeSingle();

    if (sessionError || !session) {
      return {
        statusCode: 401,
        body: JSON.stringify({ success: false, error: 'Invalid session' })
      };
    }

    if (new Date(session.expires_at) < new Date()) {
      return {
        statusCode: 401,
        body: JSON.stringify({ success: false, error: 'Session expired' })
      };
    }

    // ✅ Fetch user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', session.user_email)
      .maybeSingle();

    if (userError || !user) {
      return {
        statusCode: 404,
        body: JSON.stringify({ success: false, error: 'User not found' })
      };
    }

    // ✅ Sanitize output
    const safeUser = { ...user };
    delete safeUser.password;
    delete safeUser.encrypted_password;

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, user: safeUser })
    };

  } catch (err) {
    console.error('getUser error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Failed to fetch user' })
    };
  }
};
