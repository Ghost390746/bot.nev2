// netlify/functions/view-videos.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-only
const supabase = createClient(supabaseUrl, supabaseKey);

export const handler = async () => {
  try {
    // List all files in the 'videos' bucket
    const { data: files, error: listError } = await supabase
      .storage
      .from('videos')
      .list('', { limit: 100, offset: 0 });

    if (listError) return { statusCode: 500, body: listError.message };
    if (!files || files.length === 0) return { statusCode: 200, body: JSON.stringify([]) };

    const videosWithUser = await Promise.all(
      files.map(async (file) => {
        // Create signed URL
        const { data: signedUrlData, error: signedUrlError } = await supabase
          .storage
          .from('videos')
          .createSignedUrl(file.name, 3600); // 1 hour expiry

        if (signedUrlError) return null;

        // Try to get video metadata from videos table
        const { data: videoRecord } = await supabase
          .from('videos')
          .select('user_id')
          .eq('video_url', file.name)
          .maybeSingle();

        let user = null;
        if (videoRecord) {
          const { data: userData } = await supabase
            .from('users')
            .select('id, email')
            .eq('id', videoRecord.user_id)
            .maybeSingle();
          if (userData) user = { id: userData.id, email: userData.email };
        }

        return {
          name: file.name,
          size: file.size,
          updated_at: file.updated_at,
          videoUrl: signedUrlData.signedUrl,
          user
        };
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify(videosWithUser.filter(v => v))
    };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};
