// functions/api/summarize.js
// Cloudflare Pages Function — berjalan di edge server Cloudflare, bukan di browser.
// Rute otomatis menjadi /api/summarize karena file ini berada di functions/api/summarize.js
//
// Mendukung 3 penyedia AI, dipilih lewat field "provider" dari frontend:
//   - "anthropic" -> Claude, butuh env var ANTHROPIC_API_KEY
//   - "gemini"    -> Google Gemini, butuh env var GEMINI_API_KEY
//   - "openai"    -> ChatGPT, butuh env var OPENAI_API_KEY
// Atur variabel-variabel ini di dashboard Cloudflare:
// Workers & Pages > nama proyek > Settings > Environment variables.
// Anda tidak wajib mengisi ketiganya — cukup isi API key untuk provider yang ingin dipakai.
//
// Nama model di bawah ini bisa berubah sewaktu-waktu mengikuti rilis terbaru
// masing-masing penyedia; sesuaikan konstanta MODELS jika model ini sudah usang.
const MODELS = {
  anthropic: 'claude-sonnet-4-6',
  gemini: 'gemini-3.6-flash',
  openai: 'gpt-4o-mini'
};

const SYSTEM_PROMPT = `Kamu adalah asisten yang menyusun notulen rapat profesional dalam Bahasa Indonesia formal. Kamu menerima transkrip mentah hasil pengenalan suara sebuah rapat, yang mungkin mengandung kesalahan ejaan, kata terpotong, atau campuran Bahasa Indonesia/Sunda/Inggris akibat keterbatasan teknologi speech-to-text. Pahami maksud pembicaraan meski ada ketidaksempurnaan tersebut. Balas HANYA dengan objek JSON murni, tanpa teks pembuka, tanpa penjelasan, tanpa markdown, tanpa tanda backtick, persis dengan struktur berikut:
{"ringkasan": "satu atau dua paragraf ringkasan jalannya rapat", "poin_penting": ["poin 1", "poin 2"], "keputusan": ["keputusan 1"], "tindak_lanjut": [{"tugas": "deskripsi tugas", "penanggung_jawab": "nama jika disebut atau -", "tenggat": "tenggat jika disebut atau -"}]}
Jika suatu bagian tidak memiliki informasi dalam transkrip, isi dengan array kosong []. Jangan mengarang informasi yang tidak ada dalam transkrip.`;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function extractJson(rawText) {
  const clean = rawText.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

async function callAnthropic(env, title, transcript) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'ANTHROPIC_API_KEY belum diatur di environment variables Cloudflare Pages.', status: 500 };

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODELS.anthropic,
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Judul rapat: ${title}\n\nTranskrip:\n${transcript}` }]
    })
  });
  const data = await resp.json();
  if (!resp.ok) {
    return { error: (data && data.error && data.error.message) || 'Gagal menghubungi Claude (Anthropic).', status: resp.status };
  }
  const textOut = (data.content || []).map((b) => b.text || '').join('\n');
  return { parsed: extractJson(textOut) };
}

async function callGemini(env, title, transcript) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return { error: 'GEMINI_API_KEY belum diatur di environment variables Cloudflare Pages.', status: 500 };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.gemini}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: `Judul rapat: ${title}\n\nTranskrip:\n${transcript}` }] }],
      generationConfig: { responseMimeType: 'application/json' }
    })
  });
  const data = await resp.json();
  if (!resp.ok) {
    return { error: (data && data.error && data.error.message) || 'Gagal menghubungi Google Gemini.', status: resp.status };
  }
  const textOut = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n') || '';
  if (!textOut) return { error: 'Gemini tidak mengembalikan hasil (kemungkinan diblokir filter keamanan).', status: 502 };
  return { parsed: extractJson(textOut) };
}

async function callOpenAI(env, title, transcript) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return { error: 'OPENAI_API_KEY belum diatur di environment variables Cloudflare Pages.', status: 500 };

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: MODELS.openai,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Judul rapat: ${title}\n\nTranskrip:\n${transcript}` }
      ]
    })
  });
  const data = await resp.json();
  if (!resp.ok) {
    return { error: (data && data.error && data.error.message) || 'Gagal menghubungi ChatGPT (OpenAI).', status: resp.status };
  }
  const textOut = data?.choices?.[0]?.message?.content || '';
  return { parsed: extractJson(textOut) };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ error: 'Body permintaan tidak valid.' }, 400);
  }

  const title = (payload.title || 'Rapat Tanpa Judul').toString().slice(0, 200);
  const transcript = (payload.transcript || '').toString();
  const provider = (payload.provider || 'anthropic').toString();

  if (transcript.trim().length < 10) {
    return json({ error: 'Transkrip terlalu pendek untuk dirangkum.' }, 400);
  }

  let result;
  try {
    if (provider === 'gemini') {
      result = await callGemini(env, title, transcript);
    } else if (provider === 'openai') {
      result = await callOpenAI(env, title, transcript);
    } else {
      result = await callAnthropic(env, title, transcript);
    }
  } catch (err) {
    return json({ error: 'Respons AI tidak dalam format JSON yang diharapkan, atau layanan sedang bermasalah.' }, 502);
  }

  if (result.error) {
    return json({ error: result.error }, result.status || 500);
  }
  return json(result.parsed, 200);
}

export async function onRequestGet() {
  return json({ error: 'Gunakan metode POST untuk endpoint ini.' }, 405);
}
