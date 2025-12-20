import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Generate device fingerprint based on headers
function getDeviceFingerprint(headers) {
  const source = headers['user-agent'] + headers['accept-language'] + (headers['x-forwarded-for'] || '');
  return crypto.createHash('sha256').update(source).digest('hex');
}

export const handler = async (event) => {
  try {
    // Parse cookies
    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token = cookies['__Host-session_secure'] || cookies['session_token'];

    if (!session_token) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not authenticated' }) };
    }

    // Verify session
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('user_email, expires_at, fingerprint')
      .eq('session_token', session_token)
      .maybeSingle();

    if (sessionError || !sessionData) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Invalid session' }) };
    }

    // Check expiration
    if (new Date(sessionData.expires_at) < new Date()) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Session expired' }) };
    }

    // Verify device fingerprint
    const currentFingerprint = getDeviceFingerprint(event.headers);
    if (sessionData.fingerprint && sessionData.fingerprint !== currentFingerprint) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Session invalid for this device' }) };
    }

    const user_email = sessionData.user_email;

    // Fetch emails with sender info
    const { data: emails, error: emailsError } = await supabase
      .from('emails')
      .select(`
        id,
        subject,
        body,
        created_at,
        from_user,
        from_user:users!emails_from_user_fkey (
          username,
          avatar_url,
          last_online
        )
      `)
      .eq('to_user', user_email)
      .order('created_at', { ascending: false });

    if (emailsError) throw emailsError;

    // Map online status and set default avatar if missing
    const mappedEmails = emails.map(e => {
      const sender = e.from_user || {};
      const lastActive = new Date(sender.last_online || 0);
      const online = (Date.now() - lastActive.getTime()) < 5 * 60 * 1000; // online if last 5 min
      return {
        id: e.id,
        subject: e.subject,
        body: e.body,
        created_at: e.created_at,
        from: {
          email: e.from_user,
          username: sender.username || e.from_user,
          avatar_url: sender.avatar_url || `https://avatars.dicebear.com/api/initials/${encodeURIComponent(sender.username || e.from_user)}.svg`,
          online
        }
      };
    });

    return { statusCode: 200, body: JSON.stringify({ success: true, emails: mappedEmails }) };
  } catch (err) {
    console.error('getEmails error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error', details: err.message }) };
  }
};
