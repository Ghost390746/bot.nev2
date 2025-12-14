import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
    }

    // -----------------------------
    // Read session token from cookie
    // -----------------------------
    const cookies = event.headers.cookie || '';
    const match = cookies.match(/session_token=([^;]+)/);
    const session_token = match ? match[1] : null;

    if (!session_token) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Unauthorized: No session token.' }) };
    }

    // -----------------------------
    // Verify session & get user
    // -----------------------------
    const { data: sessions, error: sessionError } = await supabase
      .from('sessions') // assume you have a 'sessions' table storing {id, user_id, token, expires_at}
      .select('user_id')
      .eq('token', session_token)
      .single();

    if (sessionError || !sessions) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Invalid session.' }) };
    }

    const user_id = sessions.user_id;

    const {
      step,
      username,
      bio,
      profile_picture,
      fbx_avatar_ids,
      online_status, // online/offline
      new_password,  // for password change
      current_password
    } = JSON.parse(event.body);

    // -----------------------------
    // Fetch user by ID
    // -----------------------------
    let { data: user, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('id', user_id)
      .single();

    if (fetchError || !user) {
      return { statusCode: 404, body: JSON.stringify({ success: false, error: 'User not found.' }) };
    }

    const updates = {};

    // -----------------------------
    // Handle profile creation steps
    // -----------------------------
    if (step) {
      switch (step) {
        case 1:
          if (!username || !bio) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Username and bio required.' }) };
          updates.username = username;
          updates.bio = bio;
          break;
        case 2:
          if (!profile_picture) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Profile picture required.' }) };
          updates.profile_picture = profile_picture;
          break;
        case 3:
          if (!fbx_avatar_ids || !Array.isArray(fbx_avatar_ids) || fbx_avatar_ids.length > 3)
            return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Must select up to 3 FBX avatars.' }) };
          updates.fbx_avatar_ids = fbx_avatar_ids;
          break;
        case 4:
          updates.completed_profile = true;
          break;
        default:
          return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid step.' }) };
      }
    }

    // -----------------------------
    // Online/Offline status
    // -----------------------------
    if (online_status) {
      if (!['online', 'offline'].includes(online_status))
        return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid online_status value.' }) };
      updates.online_status = online_status;
      updates.last_online = new Date().toISOString();
    }

    // -----------------------------
    // Change password
    // -----------------------------
    if (new_password) {
      if (!current_password) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Current password required.' }) };

      const match = await bcrypt.compare(current_password, user.password);
      if (!match) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Incorrect current password.' }) };

      updates.password = await bcrypt.hash(new_password, 10);
    }

    // -----------------------------
    // Apply updates
    // -----------------------------
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update(updates)
      .eq('id', user_id)
      .select()
      .single();

    if (updateError) throw updateError;

    const responseUser = { ...user, ...updatedUser, password: undefined };

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Profile updated successfully!',
        user: responseUser
      })
    };

  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Failed to update profile.' })
    };
  }
};
