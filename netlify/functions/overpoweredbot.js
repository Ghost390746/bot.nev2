import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import readline from 'readline';
import fetch from 'node-fetch';

// ---------------------- Supabase Client ----------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing Supabase credentials!");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------------- Security Helpers ----------------------
function generateSecureToken() {
  return crypto.randomBytes(48).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateAPIKey() {
  return crypto.randomBytes(32).toString('base64url');
}

function isValidInput(str) {
  return typeof str === 'string' && str.length > 0 && str.length < 500;
}

// ---------------------- Rate Limiting ----------------------
const rateMap = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const record = rateMap.get(ip) || { count: 0, time: now };
  if (now - record.time > 60000) {
    rateMap.set(ip, { count: 1, time: now });
    return true;
  }
  if (record.count > 30) return false;
  record.count++;
  rateMap.set(ip, record);
  return true;
}

// ---------------------- Moderation ----------------------
function moderateContent(files) {
  const harmfulPatterns = ["<script", "eval(", "malicious"];
  return Object.values(files).some(file =>
    harmfulPatterns.some(pattern => file.includes(pattern))
  );
}

// ---------------------- AI Engines ----------------------
function updateEmotion(state, message) {
  if (message.includes("thank")) state.trust += 0.05;
  if (message.includes("hate")) state.stress += 0.1;
  state.trust = Math.min(1, Math.max(0, state.trust));
  state.stress = Math.min(1, Math.max(0, state.stress));
  return state;
}

function storeMemory(memories, user, fact, importance = 0.5) {
  memories.push({ user, fact, importance });
  return memories.slice(-100);
}

// ---------------------- Free AI ----------------------
async function freeAI(prompt, persona) {
  const response = await fetch("https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: `Personality:${JSON.stringify(persona)}\nUser:${prompt}\nBot:`
    })
  });
  const data = await response.json();
  return data[0]?.generated_text || "...";
}

// ---------------------- Bot Generator ----------------------
function generateUserFiles({ name, description, voice_id, fbx_model_id, apiKey }) {
  return {
    "bot.js": `// AI Bot Runtime\nconst API_KEY="${apiKey}";`
  };
}

// ---------------------- Create Bot ----------------------
async function createBot({ name, description, voice_id, fbx_model_id, paid_link, personality, emotional_state, goals, expressions, dialogue, memories, dialogue_state }, ip) {

  if (!rateLimit(ip)) return { error: "Too many requests" };
  if (![name, description, voice_id, fbx_model_id].every(isValidInput)) return { error: "Invalid input" };

  const apiKey = generateAPIKey();
  const rawToken = generateSecureToken();
  const hashedToken = hashToken(rawToken);
  const tokenExpiry = Date.now() + 15 * 60 * 1000; // 15 minutes

  const files = generateUserFiles({ name, description, voice_id, fbx_model_id, apiKey });
  if (moderateContent(files)) return { error: "Harmful content detected" };

  // Default structures if not provided
  personality = personality || { tone: "friendly", traits: ["curious"], values: ["honesty"], boundaries: ["no violence"] };
  emotional_state = emotional_state || { mood: "curious", trust: 0.5, stress: 0.2 };
  goals = Array.isArray(goals) && goals.length ? goals : [{ goal: "Help user", priority: 1 }];
  expressions = Array.isArray(expressions) && expressions.length ? expressions : [];
  dialogue = dialogue || "";
  memories = Array.isArray(memories) ? memories : [];
  dialogue_state = dialogue_state || {};

  const bot = {
    name,
    description,
    files,
    api_key: apiKey,
    voice_id,
    fbx_model_id,
    paid_link: paid_link || null,
    created_at: new Date().toISOString(),

    personality,
    emotional_state,
    goals,
    expressions,
    dialogue,
    memories,
    dialogue_state,

    token_hash: hashedToken,
    token_expiry: tokenExpiry
  };

  // --- Insert and return exact error ---
  const { data, error } = await supabase.from('bots').insert(bot);
  if (error) {
    // Return full Supabase error info
    return {
      error: error.message || "Database error",
      details: error.details || null,
      hint: error.hint || null,
      code: error.code || null
    };
  }

  return {
    message: "Bot created. Save this token now — it will never be shown again.",
    bot_token: rawToken,
    api_key: apiKey,
    expires_in_minutes: 15
  };
}

// ---------------------- Netlify Handler ----------------------
export async function handler(event) {
  const ip = event.headers['x-forwarded-for'] || 'unknown';
  const body = event.body ? JSON.parse(event.body) : {};

  if (body.action === "createbot") {
    const result = await createBot(body, ip);
    return { statusCode: 200, body: JSON.stringify(result) };
  }

  return { statusCode: 400, body: "Invalid request" };
}
