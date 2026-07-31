// Conversational AI agent for the Amazon Ads dashboard.
//
// Wraps Google Gemini in a tool-use loop: the model reads the user's question,
// calls the read-only data tools it needs (tools.js), then answers in plain
// language grounded in the real numbers. This is the "chatbot" layer — it does
// NOT change anything, it only reads and explains.

import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { TOOL_DEFS, runTool } from './tools.js';

// Built lazily on first use so the rest of the backend still boots when
// GEMINI_API_KEY isn't set.
let _client = null;
function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('AI is not configured — set GEMINI_API_KEY in backend/.env.');
  }
  if (!_client) _client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return _client;
}

// Flash-Lite is the fastest flash tier and has the highest free-tier quota, so
// the chat stays fast and doesn't hit the limit after a few questions. We use
// the "-latest" alias (not a pinned version) so Google can't retire the exact
// model out from under us — pinned 2.5-flash-lite started returning 404 for new
// users, and 2.5-flash is 404 too; this alias tracks the current flash-lite.
const MODEL = 'gemini-flash-lite-latest';
const MAX_STEPS = 5; // safety cap on tool-call rounds per message (fewer rounds = fewer requests + faster)
const MAX_RETRIES = 3; // retries on transient 429 rate-limit / 503 overload

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Call Gemini, retrying on rate-limit (429) / overload (503). The free tier is
// only a few requests per minute, so a short wait usually clears it. We honour
// the server's suggested retryDelay when present, capped so we never hang long.
async function generateWithRetry(ai, params) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (e) {
      const status = e?.status || e?.code;
      const retryable = status === 429 || status === 503
        || /RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded/i.test(e?.message || '');
      if (!retryable || attempt >= MAX_RETRIES) throw e;
      const suggested = Number(String(e?.message || '').match(/retry in ([\d.]+)s/i)?.[1]);
      const waitMs = Math.min(
        (Number.isFinite(suggested) ? suggested * 1000 : 0) || 1500 * (attempt + 1),
        20000,
      );
      await sleep(waitMs);
    }
  }
}

// Reuse the shared tool catalogue (tools.js) as the single source of truth.
// Gemini's function declarations use the same {name, description, parameters}
// shape, where `parameters` is the JSON Schema we already wrote as input_schema.
const functionDeclarations = TOOL_DEFS.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: t.input_schema,
}));

const ymd = (d) => d.toISOString().slice(0, 10);

// The chat UI renders replies as plain text, so any Markdown syntax or emoji the
// model emits shows up as literal clutter. Strip it as a safety net on top of the
// system-prompt instructions, without touching the actual words or numbers.
function toPlainText(text) {
  return text
    // Drop emoji and other pictographic/symbol characters.
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️‍]/gu, '')
    // Strip inline emphasis markers: **bold**, __bold__, *italic*, _italic_, `code`.
    .replace(/(\*\*|__|\*|_|`)(.*?)\1/g, '$2')
    .split('\n')
    .map((line) => line
      // Leading heading hashes and blockquote markers.
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s{0,3}>\s?/, '')
      // A line that is only a horizontal rule (---, ***, ___).
      .replace(/^\s*([-*_])(?:\s*\1){2,}\s*$/, '')
      // Normalise bullet markers (*, +, •) to "- ".
      .replace(/^(\s*)[*+•]\s+/, '$1- ')
      .trimEnd())
    // Collapse 3+ blank lines left behind into a single blank line.
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function systemPrompt() {
  return [
    'You are an Amazon Advertising analyst assistant embedded in a Sponsored Products dashboard.',
    'You help the seller understand their ad performance and give clear, actionable recommendations.',
    '',
    `Today's date is ${ymd(new Date())}. All money is in USD.`,
    '',
    'How to answer:',
    '- ALWAYS ground answers in real data by calling the tools. Never invent numbers, campaign names, or metrics.',
    '- If a needed report has not been uploaded yet (the tools will say so), tell the user which report to upload rather than guessing.',
    '- Match the user\'s language and tone. If they write in Taglish, reply in Taglish.',
    '- Be concise and lead with the answer. Use short bullet points for lists of campaigns/terms/recommendations.',
    '- Explain metrics briefly when helpful: ACoS = ad spend / ad sales (lower is better), ROAS = ad sales / spend (higher is better), TACoS = ad spend / total sales.',
    '- When giving advice, be specific and tie it to the numbers you pulled (e.g. name the campaign and its ACoS).',
    '- You are read-only: you can analyze and recommend, but you cannot change bids, budgets, or anything on Amazon. Tell the user what to do; they make the change.',
    '',
    'Formatting (IMPORTANT — the chat shows your reply as plain text, so Markdown and emoji appear as literal clutter):',
    '- Reply in plain text only. Do NOT use Markdown or any special formatting characters.',
    '- Never use asterisks (**bold**, *italic*), hash headings (#, ##, ###), backticks, or horizontal rules (---).',
    '- Do NOT use emoji or other decorative symbols.',
    '- For sections, use a plain label followed by a colon on its own line (e.g. "Headline metrics:").',
    '- For lists, start each line with "- " and a space. Keep one item per line.',
    '- Separate sections with a single blank line, not divider characters.',
  ].join('\n');
}

/**
 * Run one chat turn.
 * @param {{ messages: Array<{role:'user'|'assistant', content:string}>, profileId?: string }} args
 *   `messages` is the plain-text conversation history (no tool blocks).
 * @returns {Promise<{ reply: string }>}
 */
export async function chat({ messages, profileId }) {
  const ai = getClient();
  const pid = profileId || config.profileId;
  const ctx = { profileId: pid };

  // Gemini "contents": role is 'user' | 'model' (assistant → model). Working
  // copy starts from the text history and grows with tool-call rounds.
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await generateWithRetry(ai, {
      model: MODEL,
      contents,
      config: {
        systemInstruction: systemPrompt(),
        tools: [{ functionDeclarations }],
      },
    });

    const parts = res.candidates?.[0]?.content?.parts || [];
    const calls = parts.filter((p) => p.functionCall);

    if (calls.length > 0) {
      // Echo the model turn (incl. the function_call parts) back verbatim.
      contents.push({ role: 'model', parts });

      const responseParts = [];
      for (const p of calls) {
        const { name, args } = p.functionCall;
        try {
          const result = runTool(name, args || {}, ctx);
          responseParts.push({ functionResponse: { name, response: { result } } });
        } catch (e) {
          responseParts.push({ functionResponse: { name, response: { error: e.message } } });
        }
      }
      contents.push({ role: 'user', parts: responseParts });
      continue; // let Gemini read the results and continue
    }

    // Normal completion — return the text.
    const reply = parts
      .filter((p) => typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n')
      .trim();
    return { reply: toPlainText(reply) || 'Done.' };
  }

  return { reply: 'I gathered a lot of data but couldn\'t finish — please try asking a more specific question.' };
}
