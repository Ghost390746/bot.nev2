import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';
import DOMPurify from 'isomorphic-dompurify'; // safe HTML sanitizer
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Rate limiting in memory (for example purposes; production should use Redis or similar)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 min
const RATE_LIMIT_MAX = 30; // max requests per window

// Hash tokens before DB comparison for extra security
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
    }

    // Rate limiting
    const ip = event.headers['x-forwarded-for'] || event.headers['remote_addr'] || 'unknown';
    const now = Date.now();
    if (!rateLimitMap.has(ip)) rateLimitMap.set(ip, []);
    const timestamps = rateLimitMap.get(ip).filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
    if (timestamps.length >= RATE_LIMIT_MAX) {
      return { statusCode: 429, body: JSON.stringify({ success: false, error: 'Too many requests' }) };
    }
    timestamps.push(now);
    rateLimitMap.set(ip, timestamps);

    // Parse and validate cookie
    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token = cookies['__Host-session_secure'];
    if (!session_token) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not authenticated' }) };
    }
    const hashedToken = hashToken(session_token);

    // Verify session
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('user_email, expires_at')
      .eq('session_token', hashedToken)
      .single();

    if (sessionError || !sessionData) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Invalid session' }) };
    }
    if (new Date(sessionData.expires_at) < new Date()) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Session expired' }) };
    }

    const user_email = sessionData.user_email;

    // Pagination: strict validation
    let page = parseInt(event.queryStringParameters?.page || '1', 10);
    let pageSize = parseInt(event.queryStringParameters?.pageSize || '20', 10);
    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(pageSize) || pageSize < 1 || pageSize > 100) pageSize = 20; // max 100
    const offset = (page - 1) * pageSize;

    // Fetch emails safely
    const { data: emails, error: emailsError } = await supabase
      .from('emails')
      .select('id, from_user, subject, body, created_at')
      .eq('to_user', user_email)
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (emailsError) {
      console.error('Supabase fetch error:', emailsError);
      return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Failed to fetch emails' }) };
    }

    // Sanitize email bodies
    const safeEmails = emails.map((email) => ({
      id: email.id,
      from_user: DOMPurify.sanitize(email.from_user),
      subject: DOMPurify.sanitize(email.subject),
      body: DOMPurify.sanitize(email.body),
      created_at: email.created_at,
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        emails: safeEmails,
        page,
        pageSize,
      }),
    };

  } catch (err) {
    console.error('getInbox error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Internal server error' }),
    };
  }
};
