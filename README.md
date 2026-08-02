# transjawa-aho

Service penerjemah kata/kalimat **Jawa → Indonesia** menggunakan algoritma **Aho-Corasick**. Kamusnya dibaca langsung dari database MySQL aplikasi Trans Jawa (`transjawa-panel`), lalu dimuat ke automaton di memori dan diekspos sebagai HTTP API untuk dikonsumsi Laravel.

```
Laravel  --POST /translate {"text": "..."}-->  transjawa-aho  -->  JSON hasil
   |                                                 |
   +---------- MySQL trans_jawa <-- vocab/meanings ---+
```

## Cara kerja

Kamus dibangun dari tabel `vocabularies` (tiap kata punya tingkatan `ngoko`, `krama`, `inggil`) yang dipetakan ke `meanings` berbahasa Indonesia. Satu vocabulary menghasilkan sampai 3 pattern (satu per tingkatan) yang semuanya menunjuk ke entry terjemahan yang sama; tingkatan dengan kata identik (misal `krama` = `inggil`) digabung jadi satu pattern.

Matching-nya **berbasis token/kata**, bukan karakter. Ini penting: `abang` tidak akan salah cocok di dalam kata seperti `sembarang`, dan frasa multi-kata (`sega abang` → `nasi merah`) dicocokkan sebagai satu unit. Saat ada tumpang-tindih, dipilih match **terpanjang** (leftmost-longest).

Automaton di-cache di memori setelah boot. Kalau ada vocabulary/meaning baru di database, panggil `POST /reload` untuk rebuild.

## Setup

```bash
bun install
```

Buat `.env` berisi kredensial database (mengikuti `.env` milik `transjawa-panel`):

```
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=trans_jawa
DB_USERNAME=root
DB_PASSWORD=
```

Tes koneksi database:

```bash
bun run check
```

## Menjalankan

```bash
bun run serve
```

Default listen di port `3001`, override lewat env `PORT`:

```bash
PORT=3011 bun run serve
```

## Endpoint

### `POST /translate`

Request:

```json
{ "text": "Klambiku abang" }
```

Response:

```json
{
  "input": "Klambiku abang",
  "output": "Klambiku merah",
  "matches": [
    {
      "source": "abang",
      "translation": "merah",
      "meanings": ["merah"],
      "level": "ngoko",
      "type": "kerja",
      "vocabularyId": 2,
      "start": 9,
      "end": 14
    }
  ],
  "tokens": [
    { "text": "Klambiku ", "match": null },
    { "text": "abang", "match": { "translation": "merah", "meanings": ["merah"] } }
  ]
}
```

Keterangan field:

| Field | Kegunaan |
|---|---|
| `output` | Kalimat hasil, tiap kata yang cocok diganti arti pertama. Cocok untuk preview cepat. |
| `matches` | Daftar kata/frasa yang ketemu di kamus, dengan `start`/`end` berupa offset karakter di input. |
| `meanings` | Semua arti yang tersedia untuk entry tersebut. Dipakai untuk dropdown pilihan user di frontend. |
| `tokens` | Seluruh input dipecah jadi potongan berurutan. `match: null` berarti teks biasa, selain itu potongan yang diterjemahkan. |

`tokens` bersifat **lossless** — menggabungkan semua `token.text` mengembalikan input persis apa adanya, termasuk spasi dan tanda baca. Jadi frontend bisa me-render kalimat utuh sambil menyisipkan dropdown tanpa perlu menghitung offset sendiri:

```js
tokens.map(tok =>
  tok.match === null
    ? tok.text                                   // teks biasa
    : renderDropdown(tok.match.meanings)         // pilihan arti
);
```

### `POST /reload`

Rebuild kamus + automaton dari database. Panggil setelah ada data vocabulary/meaning baru.

```json
{ "status": "reloaded", "patternCount": 149, "loadedAt": "2026-08-01T05:54:35.366Z" }
```

### `GET /health`

```json
{ "status": "ok", "ready": true, "patternCount": 149, "loadedAt": "..." }
```

## Contoh curl

```bash
curl -s -X POST http://localhost:3001/translate -H 'Content-Type: application/json' -d '{"text":"Klambiku abang, aku arep adang sega."}'
```

```bash
curl -s -X POST http://localhost:3001/reload
```

```bash
curl -s http://localhost:3001/health
```

## Integrasi Laravel

```php
use Illuminate\Support\Facades\Http;

$res = Http::post(config('services.transjawa_aho.url').'/translate', [
    'text' => 'Klambiku abang',
])->json();

// $res['output'] => "Klambiku merah"
// $res['tokens'] => dipakai frontend untuk render dropdown arti
```

Saat ada vocabulary/meaning baru (misal dari observer atau setelah import), refresh cache automaton:

```php
Http::post(config('services.transjawa_aho.url').'/reload');
```

Simpan base URL-nya di `.env` Laravel supaya tidak hardcode:

```
TRANSJAWA_AHO_URL=http://127.0.0.1:3001
```

Untuk produksi, jaga proses Bun tetap hidup pakai systemd, pm2, atau supervisor.

## Script

| Perintah | Fungsi |
|---|---|
| `bun run serve` | Jalankan server |
| `bun run dev` | Server dengan hot reload |
| `bun run check` | Tes koneksi MySQL, tampilkan daftar tabel |
| `bun run dict` | Build kamus dari DB, tampilkan contoh pattern |
| `bun test` | Jalankan test suite |

## Struktur

```
src/
  config/env.ts           # kredensial DB + TARGET_LANG, dibaca dari .env
  db/pool.ts              # connection pool mysql2
  dictionary/
    types.ts              # VocabEntry, DictPattern, Dictionary, row types
    normalize.ts          # normalisasi surface form (lowercase, rapikan spasi)
    repository.ts         # semua query DB, terisolasi di sini
    builder.ts            # transform murni rows -> Dictionary, tanpa I/O
    index.ts              # barrel + loadDictionary()
  matcher/
    aho-corasick.ts       # automaton token-based
    tokenizer.ts          # pecah teks jadi token + offset karakter
    translator.ts         # dictionary -> automaton, longest-match, rakit hasil
  server/
    translator-store.ts   # cache automaton di memori, reload() dari DB
    index.ts              # Bun.serve: /translate, /reload, /health
scripts/                  # script operasional sekali jalan
tests/                    # test suite (bun test)
```

Query database (`repository.ts`) sengaja dipisah dari transformasi data (`builder.ts`). `buildDictionaryFromRows()` murni tanpa I/O, jadi bisa diuji pakai fixture in-memory tanpa perlu database hidup. `loadDictionary()` menerima `pool` sebagai argumen supaya mudah di-inject saat test.

## Testing

```bash
bun test
```

Semua test memakai fixture in-memory, tidak butuh koneksi database.

## Dependency

- [`mysql2`](https://www.npmjs.com/package/mysql2) — driver MySQL (Bun `Bun.sql` hanya mendukung Postgres)
- [`modern-ahocorasick`](https://www.npmjs.com/package/modern-ahocorasick) — implementasi Aho-Corasick

Library Aho-Corasick tersebut bekerja per karakter, sementara kebutuhan di sini per kata. Karena itu di `src/matcher/aho-corasick.ts` library-nya dibungkus interface token-based: tiap token dibungkus karakter sentinel (`\x01`) sehingga batas kata tetap terjaga.
