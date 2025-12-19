import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Generate device fingerprint hash
function getDeviceFingerprint(headers) {
  const source = headers['user-agent'] + headers['accept-language'] + (headers['x-forwarded-for'] || '');
  return crypto.createHash('sha256').update(source).digest('hex');
}

export const handler = async (event) => {
  try {
    // 🍪 Parse cookies safely
    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token = cookies['__Host-session_secure'] || cookies['session_token'];
    
    if (!session_token || typeof session_token !== 'string') {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not authenticated: missing or invalid session token' }) };
    }

    // 🔐 Verify session with expiration
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('user_email, expires_at, fingerprint')
      .eq('session_token', session_token)
      .single();

    if (sessionError || !sessionData) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Invalid or expired session' }) };
    }

    // Check session expiration
    if (new Date(sessionData.expires_at) < new Date()) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Session expired' }) };
    }

    // Device fingerprint verification
    const currentFingerprint = getDeviceFingerprint(event.headers);
    if (sessionData.fingerprint && sessionData.fingerprint !== currentFingerprint) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Session invalid for this device' }) };
    }

    const user_email = sessionData.user_email;

    // Fetch emails securely, only safe fields
    const { data: emails, error: emailsError } = await supabase
      .from('emails')
      .select('id, subject, from_user, created_at') // avoid sending sensitive raw fields
      .eq('to_user', user_email)
      .order('created_at', { ascending: false });

    if (emailsError) throw emailsError;

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, emails })
    };

  } catch (err) {
    console.error('getEmails error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Internal server error', details: err.message })
    };
  }
};
