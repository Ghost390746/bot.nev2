import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function decryptSessionToken(token) {
  try {
    const [ivHex, tagHex, encryptedHex] = token.split(':');
    const key = crypto.scryptSync(process.env.SESSION_SECRET, 'salt', 32);
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
  } catch {
    return null;
  }
}

export const handler = async (event) => {
  try {
    const cookieHeader = event.headers.cookie || '';
    const sessionMatch = cookieHeader.match(/__Host-session_secure=([^;]+)/);
    if (!sessionMatch) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'No session cookie' }) };
    const sessionToken = sessionMatch[1];
    const userUUID = decryptSessionToken(sessionToken);
    if (!userUUID) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Invalid session token' }) };

    // Verify session
    const { data: session } = await supabase.from('sessions')
      .select('user_email, expires_at')
      .eq('session_token', sessionToken)
      .maybeSingle();

    if (!session || new Date(session.expires_at) < new Date()) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Session expired or invalid' }) };
    }

    // Get sender info
    const { data: sender } = await supabase.from('users')
      .select('id, email, username, avatar_url')
      .eq('email', session.user_email)
      .maybeSingle();

    if (!sender) return { statusCode: 404, body: JSON.stringify({ success: false, error: 'User not found' }) };

    const body = JSON.parse(event.body || '{}');

    // Send a message
    if (event.httpMethod === 'POST') {
      const { vibe_id, message } = body;
      if (!vibe_id || !message) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'vibe_id and message required' }) };

      const { error } = await supabase.from('chats').insert([{ vibe_id, user_id: sender.id, message }]);
      if (error) return { statusCode: 500, body: JSON.stringify({ success: false, error: error.message }) };

      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    // Get messages for a vibe
    if (event.httpMethod === 'GET') {
      const vibe_id = event.queryStringParameters?.vibe_id;
      if (!vibe_id) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'vibe_id required' }) };

      const { data: messages, error } = await supabase.from('chats')
        .select('id, message, created_at, user_id')
        .eq('vibe_id', vibe_id)
        .order('created_at', { ascending: true });

      if (error) return { statusCode: 500, body: JSON.stringify({ success: false, error: error.message }) };

      // Add sender info for each message
      const messagesWithUser = await Promise.all(messages.map(async m => {
        const { data: user } = await supabase.from('users')
          .select('email, username, avatar_url')
          .eq('id', m.user_id)
          .maybeSingle();
        return { ...m, user };
      }));

      return { statusCode: 200, body: JSON.stringify({ success: true, messages: messagesWithUser }) };
    }

    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
