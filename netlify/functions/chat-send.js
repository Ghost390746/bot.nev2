import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// DOMPurify for sanitizing message content
const window = new JSDOM('').window;
const purify = DOMPurify(window);

export async function handler(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*', // update to your frontend URL for production
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
    }

    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token = cookies.session_token;

    if (!session_token) {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'No session cookie' }) };
    }

    // Verify session
    const { data: session } = await supabase
      .from('sessions')
      .select('user_email, expires_at, last_fingerprint')
      .eq('session_token', session_token)
      .maybeSingle();

    if (!session) {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Invalid session' }) };
    }

    if (new Date(session.expires_at) < new Date()) {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Session expired' }) };
    }

    const { conversation_id, sender_id, content } = JSON.parse(event.body || '{}');
    if (!conversation_id || !sender_id || !content) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing data' }) };
    }

    // Sanitize content
    const cleanContent = purify.sanitize(content);

    // Optional: device fingerprint check
    const fingerprintSource = 
      event.headers['user-agent'] + 
      event.headers['accept-language'] + 
      (event.headers['x-forwarded-for'] || '');
    const currentFingerprint = crypto.createHash('sha256').update(fingerprintSource).digest('hex');

    if (session.last_fingerprint && session.last_fingerprint !== currentFingerprint) {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Device mismatch' }) };
    }

    // Insert sanitized message
    const { error } = await supabase
      .from('messages')
      .insert([{ conversation_id, sender_id, content: cleanContent }]);

    if (error) throw error;

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Chat handler error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Server error', details: err.message }) };
  }
}
