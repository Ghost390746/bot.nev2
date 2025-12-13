import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
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
    const { data: bots, error } = await supabase
      .from('bots')
      .select('description')
      .eq('id', botId)
      .single();

    if (error || !bots) {
      return { statusCode: 404, body: "Bot not found" };
    }

    const text = bots.description || "Hello! I am your bot!";

    // Temporary file path
    const filePath = path.join('/tmp', `bot_speech_${Date.now()}.wav`);

    // Generate .wav with eSpeakNG
    await new Promise((resolve, reject) => {
      exec(`espeak-ng "${text}" -w ${filePath} -v en+m3`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Read file
    const audioData = fs.readFileSync(filePath);

    // Delete immediately after reading
    fs.unlinkSync(filePath);

    return {
      statusCode: 200,
      headers: { "Content-Type": "audio/wav" },
      body: audioData.toString('base64'),
      isBase64Encoded: true
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: "Error generating bot speech." };
  }
}
