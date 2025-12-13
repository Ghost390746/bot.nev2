import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { name, description, profile_picture, fbx_model_id, paid_link, price_points, seller_email } = JSON.parse(event.body);

    if (!name || !description || !fbx_model_id || !seller_email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields.' }) };
    }

    const { data, error } = await supabase
      .from('bots')
      .insert({
        id: uuidv4(),
        name,
        description,
        profile_picture,
        fbx_model_id,
        paid_link: paid_link || null,
        price_points: price_points || 0,
        seller_email,
        created_at: new Date()
      })
      .select()
      .single();

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ success: true, bot: data }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create bot.' }) };
  }
};
