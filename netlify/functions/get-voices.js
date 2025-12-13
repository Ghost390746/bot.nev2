import { voices } from './voices.js';

export async function handler(event, context) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(voices)
  };
}
