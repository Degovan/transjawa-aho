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

Field opsional:

| Field | Default | Keterangan |
|---|---|---|
| `direction` | `"jv-id"` | `"jv-id"` = Jawa → Indonesia (default). `"id-jv"` = Indonesia → Jawa. |
| `level` | `"ngoko"` | Hanya dipakai saat `direction: "id-jv"`. Tingkatan Jawa yang jadi hasil: `ngoko`, `krama`, atau `inggil`. Kalau level yang diminta kosong di DB untuk entry tersebut, otomatis fallback ke level lain yang terisi (urutan ngoko → krama → inggil), dan `matches[].level` menunjukkan level yang benar-benar dipakai. |

Response (`direction: "jv-id"`, default):

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

Contoh request arah sebaliknya (Indonesia → Jawa, level krama):

```json
{ "text": "Bajuku merah", "direction": "id-jv", "level": "krama" }
```

```json
{
  "input": "Bajuku merah",
  "output": "Bajuku abrit",
  "matches": [
    {
      "source": "merah",
      "translation": "abrit",
      "meanings": ["abrit"],
      "level": "krama",
      "type": "kerja",
      "vocabularyId": 2,
      "start": 7,
      "end": 12
    }
  ],
  "tokens": [
    { "text": "Bajuku ", "match": null },
    { "text": "merah", "match": { "translation": "abrit", "meanings": ["abrit"] } }
  ]
}
```

Keterangan field:

| Field | Kegunaan |
|---|---|
| `output` | Kalimat hasil. Untuk `jv-id`, tiap kata Jawa diganti arti pertama; untuk `id-jv`, tiap kata Indonesia diganti surface form Jawa pada `level` yang diminta. |
| `matches` | Daftar kata/frasa yang ketemu di kamus, dengan `start`/`end` berupa offset karakter di input. |
| `meanings` | Alternatif terjemahan di bahasa **output**, `translation` selalu di posisi pertama. Untuk `jv-id`: semua arti Indonesia yang tersedia. Untuk `id-jv`: sinonim Jawa dari vocabulary lain yang artinya sama, **semuanya di level yang sama** dengan `matches[].level` — jadi dropdown tidak pernah mencampur tingkatan (misal level `krama` tidak akan memunculkan bentuk ngoko `aba` di samping `titah`). Dipakai untuk dropdown pilihan user di frontend. |
| `tokens` | Seluruh input dipecah jadi potongan berurutan. `match: null` berarti teks biasa, selain itu potongan yang diterjemahkan. |

Catatan untuk `id-jv`: pattern arah ini dibangun dari kolom `meaning` (bahasa target), jadi kalau dua vocabulary Jawa berbeda kebetulan punya arti Indonesia yang identik, keduanya terdaftar sebagai pattern yang sama — match akan mengarah ke salah satu entry (vocabulary pertama yang diproses saat build kamus).

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
