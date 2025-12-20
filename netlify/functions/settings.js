import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Decrypt AES-GCM session token
function decryptSessionToken(token) {
  try {
    const [ivHex, tagHex, encryptedHex] = token.split(':');
    const key = crypto.scryptSync(process.env.SESSION_SECRET, 'salt', 32);
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    const decrypted = decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return null;
  }
}

// Validate that the URL is an HTTPS image
async function isValidImageUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;

    // Ping the URL to confirm it's reachable and an image
    const res = await fetch(url, { method: 'HEAD' });
    const contentType = res.headers.get('content-type') || '';
    return res.ok && contentType.startsWith('image/');
  } catch (e) {
    return false;
  }
}

export const handler = async (event) => {
  try {
    const cookieHeader = event.headers.cookie || '';
    const sessionMatch = cookieHeader.match(/__Host-session_secure=([^;]+)/);
    if (!sessionMatch) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'No session cookie found' }) };

    const sessionToken = sessionMatch[1];
    const userUUID = decryptSessionToken(sessionToken);
    if (!userUUID) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Invalid session token' }) };

    const { avatar_url, online } = JSON.parse(event.body || '{}');

    // Validate session exists and is not expired
    const { data: session } = await supabase.from('sessions')
      .select('user_email, expires_at')
      .eq('session_token', sessionToken)
      .maybeSingle();

    if (!session || new Date(session.expires_at) < new Date()) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Session expired or invalid' }) };
    }

    const updates = {};

    // Online/offline tracking
    if (typeof online === 'boolean') updates.online = online;

    // Avatar URL update
    if (avatar_url) {
      if (!(await isValidImageUrl(avatar_url))) {
        return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid or unreachable avatar URL' }) };
      }
      updates.avatar_url = avatar_url;
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from('users')
        .update(updates)
        .eq('email', session.user_email);

      if (error) return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Failed to update user', details: error.message }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'User status updated successfully',
        avatar_url: updates.avatar_url || null,
        online: updates.online ?? null
      })
    };

  } catch (err) {
    console.error('STATUS FUNCTION ERROR:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error', details: err.message }) };
  }
};
