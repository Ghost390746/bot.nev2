import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';

// Use SERVICE_KEY for secure reads/writes
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  try {
    // 🍪 Parse cookies
    const cookies = cookie.parse(event.headers.cookie || '');
    
    // ✅ Match login cookie names
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
      .maybeSingle();

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

    // ✅ Get all verified users excluding self with avatar & online boolean
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('email, username, avatar_url, online') // online is boolean
      .eq('verified', true)
      .neq('email', sessionData.user_email)
      .order('email', { ascending: true });

    if (usersError) throw usersError;

    // Map users for frontend
    const mappedUsers = users.map(u => ({
      email: u.email,
      username: u.username || u.email,
      avatar_url: u.avatar_url || `https://avatars.dicebear.com/api/initials/${encodeURIComponent(u.username || u.email)}.svg`,
      online: u.online // boolean directly from database
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, users: mappedUsers })
    };

  } catch (err) {
    console.error('getVerifiedUsers error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Internal server error', details: err.message })
    };
  }
};
