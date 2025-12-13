import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export async function handler(event) {
  try {
    // Get bot ID from query string
    const botId = event.queryStringParameters.botId;
    if (!botId) {
      return { statusCode: 400, body: "Missing botId parameter" };
    }

    // Fetch the bot from Supabase
    const { data: bot, error } = await supabase
      .from('bots')
      .select('description')
      .eq('id', botId)
      .single();

    if (error || !bot) {
      return { statusCode: 404, body: "Bot not found" };
    }

    // Return bot description as JSON
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: bot.description || "Hello! I am your bot!" })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: "Error fetching bot description." };
  }
}

