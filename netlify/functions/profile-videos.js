import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fetch from 'node-fetch';

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

    // Fetch user profile
    const { data: user } = await supabase.from('users')
      .select('id, email, username, avatar_url')
      .eq('email', session.user_email)
      .maybeSingle();

    if (!user) return { statusCode: 404, body: JSON.stringify({ success: false, error: 'User not found' }) };

    // Fetch uploaded videos
    const { data: videos, error: videosError } = await supabase.from('videos')
      .select('video_url, cover_url, original_filename, created_at')
      .eq('user_id', user.id);

    if (videosError) return { statusCode: 500, body: JSON.stringify({ success: false, error: videosError.message }) };

    // Generate signed URLs for videos and covers
    const videosWithUrls = await Promise.all(videos.map(async v => {
      const { data: videoSigned } = await supabase.storage.from('videos').createSignedUrl(v.video_url, 3600);
      const { data: coverSigned } = await supabase.storage.from('covers').createSignedUrl(v.cover_url, 3600);
      return {
        ...v,
        videoUrl: videoSigned.signedUrl,
        coverUrl: coverSigned.signedUrl
      };
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        user: {
          email: user.email,
          username: user.username,
          avatar_url: user.avatar_url
        },
        videos: videosWithUrls
      })
    };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
