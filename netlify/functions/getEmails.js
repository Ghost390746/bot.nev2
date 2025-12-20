import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Generate device fingerprint like login
function getDeviceFingerprint(headers, frontendFingerprint) {
  const source = frontendFingerprint || headers['user-agent'] + headers['accept-language'] + (headers['x-forwarded-for'] || '') + uuidv4();
  return crypto.createHash('sha256').update(source).digest('hex');
}

export const handler = async (event) => {
  try {
    // 🍪 Parse cookies safely
    const cookies = cookie.parse(event.headers.cookie || '');
    const rawToken = cookies['__Host-session_secure'] || cookies['session_token'];

    if (!rawToken || typeof rawToken !== 'string') {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not authenticated: missing or invalid session token' }) };
    }

    // Query Supabase to verify session
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('user_email, expires_at, fingerprint')
      .eq('session_token', rawToken) // store raw cookie in DB like login
      .single();

    if (sessionError || !sessionData) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Invalid or expired session' }) };
    }

    // Check expiration
    if (new Date(sessionData.expires_at) < new Date()) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Session expired' }) };
    }

    // Device fingerprint check
    const currentFingerprint = getDeviceFingerprint(event.headers);
    if (sessionData.fingerprint && sessionData.fingerprint !== currentFingerprint) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Session invalid for this device' }) };
    }

    const user_email = sessionData.user_email;

    // Fetch emails and sender details (avatar_url, online status) from the 'users' table
    const { data: emails, error: emailsError } = await supabase
      .from('emails')
      .select('id, subject, from_user, body, created_at, from_user:users!emails_from_user_fkey (avatar_url, last_online)')
      .eq('to_user', user_email)
      .order('created_at', { ascending: false });

    if (emailsError) throw emailsError;

    // Map emails to include sender's avatar_url and online status
    const mappedEmails = emails.map(e => {
      const sender = e.from_user || {};
      const lastOnline = new Date(sender.last_online || 0);
      const senderOnline = (Date.now() - lastOnline.getTime()) < 5 * 60 * 1000; // 5 minutes

      return {
        id: e.id,
        subject: e.subject,
        body: e.body,
        created_at: e.created_at,
        from: {
          email: e.from_user,
          avatar_url: sender.avatar_url || null, // Use the avatar_url from users table
          online: senderOnline
        }
      };
    });

    return { 
      statusCode: 200, 
      body: JSON.stringify({
        success: true,
        emails: mappedEmails
      }) 
    };
  } catch (err) {
    console.error('getEmails error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error', details: err.message }) };
  }
};
