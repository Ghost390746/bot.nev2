import { createClient } from '@supabase/supabase-js';
import { createFFmpeg, fetchFile } from '@ffmpeg/ffmpeg';
import videoMetadata from 'video-metadata-thumbnails';
import getVideoInfo from 'get-video-info';
import probe from 'probe-image-size';
import sharp from 'sharp';
import fetch from 'node-fetch';

// Initialize WebAssembly FFmpeg
const ffmpeg = createFFmpeg({ log: true });
await ffmpeg.load();

// Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export const handler = async () => {
  try {
    const { data: files, error: listError } = await supabase
      .storage
      .from('videos')
      .list('', { limit: 100, offset: 0 });

    if (listError) return { statusCode: 500, body: listError.message };
    if (!files || files.length === 0) return { statusCode: 200, body: JSON.stringify([]) };

    const videosWithUser = await Promise.all(
      files.map(async (file) => {
        const { data: videoRecord, error: videoError } = await supabase
          .from('videos')
          .select('user_id, created_at, cover_url')
          .eq('video_url', file.name)
          .maybeSingle();

        if (videoError || !videoRecord) return null;

        // Signed video URL
        const { data: signedVideoData, error: signedVideoError } = await supabase
          .storage
          .from('videos')
          .createSignedUrl(file.name, 3600);

        if (signedVideoError) return null;

        // Fetch video buffer
        const videoBuffer = await fetch(signedVideoData.signedUrl).then(res => res.arrayBuffer());

        // Get metadata using video-metadata-thumbnails
        let duration = null;
        let resolution = null;
        try {
          const metadata = await videoMetadata(new Uint8Array(videoBuffer));
          duration = metadata.duration;
          resolution = { width: metadata.width, height: metadata.height };
        } catch (err) {
          console.error('video-metadata-thumbnails error', err);
        }

        // Optional: fallback using get-video-info
        if (!duration || !resolution) {
          try {
            const info = await getVideoInfo(Buffer.from(videoBuffer));
            duration = info.duration || duration;
            resolution = resolution || { width: info.width, height: info.height };
          } catch (err) {
            console.error('get-video-info error', err);
          }
        }

        // Cover thumbnail
        let coverUrl = null;
        if (videoRecord.cover_url) {
          const { data: signedCoverData, error: signedCoverError } = await supabase
            .storage
            .from('covers')
            .createSignedUrl(videoRecord.cover_url, 3600);

          if (!signedCoverError) {
            const coverBuffer = Buffer.from(await fetch(signedCoverData.signedUrl).then(r => r.arrayBuffer()));
            
            // Optional: get dimensions with probe-image-size
            try {
              const imageMeta = probe.sync(coverBuffer);
              // imageMeta.width & imageMeta.height if needed
            } catch (err) {
              console.error('probe-image-size error', err);
            }

            await sharp(coverBuffer)
              .resize(320, 180)
              .toBuffer();
            coverUrl = signedCoverData.signedUrl;
          }
        }

        // User info
        const { data: userData } = await supabase
          .from('users')
          .select('id, email')
          .eq('id', videoRecord.user_id)
          .maybeSingle();

        const user = userData ? { id: userData.id, email: userData.email } : null;

        return {
          name: file.name,
          size: file.size,
          uploaded_at: videoRecord.created_at ? new Date(videoRecord.created_at).toISOString() : null,
          videoUrl: signedVideoData.signedUrl,
          coverUrl,
          duration,
          resolution,
          user
        };
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify(videosWithUser.filter(v => v))
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: err.message };
  }
};
