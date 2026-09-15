# Notula — Notulensi Rapat Otomatis

Aplikasi web untuk mencatat pembicaraan rapat secara langsung menjadi teks (speech-to-text di browser), lalu menyusun notulen (ringkasan, poin penting, keputusan, tindak lanjut) menggunakan pilihan model AI: Claude (Anthropic), Google Gemini, atau ChatGPT (OpenAI).

## Struktur proyek

```
notula.html               <- halaman utama (UI + logika perekaman)
functions/api/summarize.js <- Cloudflare Pages Function (backend, menyimpan API key dengan aman)
```

## Menjalankan / deploy

Proyek ini statis (tanpa proses build), jadi tidak perlu `npm install` atau build command apa pun.

1. Push repo ini ke GitHub.
2. Di [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → pilih repo ini.
3. Saat konfigurasi build:
   - Framework preset: **None**
   - Build command: (kosongkan)
   - Build output directory: `/`
4. Setelah proyek dibuat, buka **Settings → Environment variables** dan tambahkan API key untuk provider AI yang ingin dipakai (isi salah satu atau semuanya):
   - `ANTHROPIC_API_KEY` — dari https://console.anthropic.com
   - `GEMINI_API_KEY` — dari https://aistudio.google.com/apikey
   - `OPENAI_API_KEY` — dari https://platform.openai.com/api-keys
5. Redeploy setelah menambahkan environment variable (klik **Retry deployment** atau push commit baru).

Setiap push ke branch utama akan otomatis men-deploy ulang; push ke branch lain membuat preview deployment terpisah dengan URL sendiri.

## Catatan keamanan

- API key **tidak pernah** ditulis di kode (`notula.html` maupun `summarize.js`) — semuanya dibaca dari environment variable di server Cloudflare saat runtime. Jangan pernah menambahkan API key langsung ke dalam file kode atau meng-commit-nya ke repo.
- Fitur speech-to-text memerlukan browser berbasis Chromium (Chrome/Edge) dan koneksi HTTPS — otomatis terpenuhi begitu di-deploy ke `*.pages.dev` atau domain kustom.

## Menyesuaikan nama model AI

Kalau suatu saat provider merilis model baru dan nama model di kode sudah usang, ubah di `functions/api/summarize.js`, bagian `const MODELS = { ... }` di bagian atas file.
