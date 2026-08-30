# Arsitektur

## Alur data

```
Laravel  --POST /translate {"text": "..."}-->  transjawa-aho  -->  JSON hasil
   |                                                 |
   +---------- MySQL trans_jawa <-- vocab/meanings ---+
```

Saat boot, service membaca kamus dari database, membangun automaton di memori, baru menerima traffic. Automaton disimpan di memori sampai `POST /reload` menukarnya dengan yang baru.

## Struktur file

```
src/
  config/env.ts           # kredensial DB + TARGET_LANG, dibaca dari .env
  db/pool.ts              # connection pool mysql2
  dictionary/
    types.ts              # VocabEntry, DictPattern, ReversePattern, Dictionary, row types
    normalize.ts          # normalisasi surface form (lowercase, rapikan spasi)
    repository.ts         # semua query DB, terisolasi di sini
    builder.ts            # transform murni rows -> Dictionary, tanpa I/O
    index.ts              # barrel + loadDictionary()
  matcher/
    aho-corasick.ts       # automaton token-based
    affixes.ts            # rule imbuhan id->jv (data murni, gampang ditambah)
    tokenizer.ts          # pecah teks jadi token + offset karakter
    translator.ts         # dictionary -> automaton, longest-match, rakit hasil
  server/
    translator-store.ts   # cache automaton di memori, reload() dari DB
    index.ts              # Bun.serve: /translate, /reload, /health
scripts/                  # script operasional sekali jalan
tests/                    # test suite (bun test)
docs/                     # dokumentasi
```

## Pembangunan kamus

Kamus dibangun dari tabel `vocabularies` — tiap baris punya kolom `ngoko`, `krama`, `inggil` — yang dipetakan ke `meanings` berbahasa Indonesia lewat `vocabulary_id`. Hanya meaning dengan `language_id` yang cocok dengan `TARGET_LANG` yang diambil, diurutkan mengikuti kolom `order`.

Dari satu baris vocabulary dihasilkan dua jenis pattern:

**Pattern arah `jv-id`** — sampai 3 pattern, satu per tingkatan, semuanya menunjuk ke object `VocabEntry` yang sama. Tingkatan dengan kata identik (misal `krama` = `inggil`) digabung jadi satu pattern.

**Pattern arah `id-jv`** (`reversePatterns`) — satu pattern per meaning Indonesia yang berbeda, juga menunjuk ke `VocabEntry` yang sama. Karena satu entry bisa punya beberapa arti, satu vocabulary bisa menghasilkan beberapa reverse pattern.

Query database (`repository.ts`) sengaja dipisah dari transformasi data (`builder.ts`). `buildDictionaryFromRows()` murni tanpa I/O, jadi bisa diuji pakai fixture in-memory tanpa perlu database hidup. `loadDictionary()` menerima `pool` sebagai argumen supaya mudah di-inject saat test.

## Matching berbasis token

Matching dilakukan per kata, bukan per karakter. Ini penting untuk dua hal: `abang` tidak salah cocok di dalam kata seperti `sembarang`, dan frasa multi-kata (`sega abang` → `nasi merah`) dicocokkan sebagai satu unit.

Library [`modern-ahocorasick`](https://www.npmjs.com/package/modern-ahocorasick) bekerja per karakter, sementara kebutuhan di sini per kata. Karena itu di `src/matcher/aho-corasick.ts` library-nya dibungkus interface token-based: tiap token dibungkus karakter sentinel (`\x01`) sehingga batas kata tetap terjaga. Pattern `abang` jadi `\x01abang\x01`, dan haystack `sembarang` tidak pernah mengandung urutan itu.

Saat ada tumpang-tindih, dipilih match **terpanjang** (leftmost-longest): hasil di-sort berdasarkan posisi awal naik lalu panjang menurun, kemudian diterima secara greedy selama tidak menabrak match yang sudah dipilih.

## Dua automaton, satu Translator

`Translator` membangun dua automaton di constructor:

| Automaton | Sumber pattern | Dipakai oleh |
|---|---|---|
| `ac` | `dict.patterns` (surface form Jawa) | `direction: "jv-id"` |
| `reverseAc` | `dict.reversePatterns` (meaning Indonesia) | `direction: "id-jv"` |

Selain itu ada index `reverseStems`: map dari pattern Indonesia satu-kata ke daftar entry yang punya arti itu. Index ini dipakai untuk dua hal — memverifikasi kata dasar hasil pelepasan imbuhan benar-benar ada di kamus (lookup O(1)), dan menerjemahkannya tanpa menjalankan automaton lagi.

## Alur `translateIdToJv`

Arah `id-jv` jalan dua tahap:

1. **Match kamus.** Sama seperti arah sebaliknya: cari di `reverseAc`, resolusi tumpang-tindih leftmost-longest. Setiap token yang tercakup dicatat.
2. **Pelepasan imbuhan.** Token yang tidak tercakup tahap pertama dicoba dilepas imbuhannya, kata dasarnya diterjemahkan, lalu imbuhan Jawa ditempel kembali. Detailnya di [imbuhan.md](imbuhan.md).

Karena tahap kedua menambah match di posisi acak, hasilnya di-sort ulang berdasarkan offset sebelum dipakai merangkai `output` dan `tokens` — keduanya berjalan dari kiri ke kanan dan mengandalkan urutan itu.

## Sinonim tidak mencampur tingkatan

Untuk arah `id-jv`, `meanings` berisi sinonim Jawa dari vocabulary **lain** yang punya arti Indonesia sama, bukan bentuk-bentuk dari tingkatan lain dalam satu entry. Alasannya: `aba` (ngoko) dan `titah` (krama) itu kata yang sama dalam register berbeda, bukan dua pilihan setara, jadi menampilkannya bersamaan membuat dropdown mencampur tingkatan.

Implementasinya memanfaatkan sifat `AhoCorasick.search()` yang mengembalikan semua payload untuk key yang sama. Entry-entry yang share meaning otomatis muncul di span yang identik, jadi tinggal difilter berdasarkan `start`/`end` yang sama, lalu semuanya dirender di tingkatan yang sudah ditentukan.

## Caching dan reload

`translator-store.ts` menyimpan satu instance `Translator` di memori. Membangun automaton jauh lebih mahal dibanding melayani satu request, jadi dibangun sekali lalu dipakai terus.

`POST /reload` membaca ulang database, membangun `Translator` baru, dan menukarnya. Penukarannya di akhir proses, jadi request yang masuk selama rebuild masih dilayani automaton lama.

## Dependency

- [`mysql2`](https://www.npmjs.com/package/mysql2) — driver MySQL. Bun `Bun.sql` hanya mendukung Postgres, jadi tidak bisa dipakai di sini.
- [`modern-ahocorasick`](https://www.npmjs.com/package/modern-ahocorasick) — implementasi Aho-Corasick, dibungkus jadi token-based seperti dijelaskan di atas.

## Testing

```bash
bun test
```

Semua test memakai fixture in-memory, tidak butuh koneksi database. Ini mungkin karena `buildDictionaryFromRows()` dan `Translator` sama-sama menerima data biasa, bukan mengambil sendiri dari database.
