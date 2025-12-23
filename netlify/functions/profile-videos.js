import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  try {
    const userEmail = event.queryStringParameters?.email;
    if (!userEmail) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Email is required' }) };

    // Fetch user profile
    const { data: user, error: userError } = await supabase.from('users')
      .select('id, email, username, avatar_url')
      .eq('email', userEmail)
      .maybeSingle();

    if (userError) return { statusCode: 500, body: JSON.stringify({ success: false, error: userError.message }) };
    if (!user) return { statusCode: 404, body: JSON.stringify({ success: false, error: 'User not found' }) };

    // Fetch uploaded videos for this user
    const { data: videos, error: videosError } = await supabase.from('videos')
      .select('video_url, cover_url, original_filename, created_at')
      .eq('user_id', user.id);

    if (videosError) return { statusCode: 500, body: JSON.stringify({ success: false, error: videosError.message }) };

    // Generate signed URLs
    const videosWithUrls = await Promise.all(videos.map(async (v) => {
      const { data: videoSigned } = await supabase.storage.from('videos').createSignedUrl(v.video_url, 3600);
      const { data: coverSigned } = await supabase.storage.from('covers').createSignedUrl(v.cover_url, 3600);

      return {
        ...v,
        videoUrl: videoSigned?.signedUrl || null,
        coverUrl: coverSigned?.signedUrl || null
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
