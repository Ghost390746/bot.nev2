import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
    }

    const {
      email,
      step,
      username,
      bio,
      profile_picture,
      fbx_avatar_ids,
      online_status, // new: "online" or "offline"
      new_password, // new: for changing password
      current_password
    } = JSON.parse(event.body);

    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Email is required.' }) };
    }

    // Fetch user
    let { data: user, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
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
        case 1: // Username + bio
          if (!username || !bio) {
            return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Username and bio are required.' }) };
          }
          updates.username = username;
          updates.bio = bio;
          break;

        case 2: // Profile picture
          if (!profile_picture) {
            return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Profile picture is required.' }) };
          }
          updates.profile_picture = profile_picture;
          break;

        case 3: // FBX avatars
          if (!fbx_avatar_ids || !Array.isArray(fbx_avatar_ids) || fbx_avatar_ids.length > 3) {
            return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Must select up to 3 FBX avatars.' }) };
          }
          updates.fbx_avatar_ids = fbx_avatar_ids;
          break;

        case 4: // Complete profile
          updates.completed_profile = true;
          break;

        default:
          return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid step.' }) };
      }
    }

    // -----------------------------
    // Handle online/offline status
    // -----------------------------
    if (online_status) {
      if (!["online", "offline"].includes(online_status)) {
        return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid online_status value.' }) };
      }
      updates.online_status = online_status;
    }

    // -----------------------------
    // Handle password change
    // -----------------------------
    if (new_password) {
      if (!current_password) {
        return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Current password is required to change password.' }) };
      }

      // Verify current password
      const match = await bcrypt.compare(current_password, user.password);
      if (!match) {
        return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Incorrect current password.' }) };
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(new_password, 10);
      updates.password = hashedPassword;
    }

    // -----------------------------
    // Apply updates
    // -----------------------------
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update(updates)
      .eq('email', email)
      .select()
      .single();

    if (updateError) throw updateError;

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Profile updated successfully!',
        data: updatedUser
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
