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
    affixes.ts            # rule imbuhan akhir, dua arah (data murni)
    prefixes.ts           # rule awalan meN- / ater-ater (data murni)
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

## Alur penerjemahan: dua tahap

Kedua arah memakai pola yang sama:

1. **Match kamus.** Cari di automaton yang sesuai, resolusi tumpang-tindih leftmost-longest. Setiap token yang tercakup dicatat di set `covered`.
2. **Pelepasan imbuhan akhir.** Token yang tidak tercakup tahap pertama dicoba dilepas imbuhannya, kata dasarnya diterjemahkan, lalu imbuhan padanannya ditempel kembali. Detailnya di [imbuhan.md](imbuhan.md).
3. **Rekonstruksi awalan.** Token yang masih tersisa dicoba sebagai bentuk berawalan (`menulis` → `tulis`). Terakhir, supaya entry kamus dan bentuk berimbuhan selalu menang. Detailnya di [awalan.md](awalan.md).

Karena tahap kedua dan ketiga menambah match di posisi acak, hasilnya di-sort ulang berdasarkan offset sebelum dipakai merangkai `output` dan `tokens` — keduanya berjalan dari kiri ke kanan dan mengandalkan urutan itu.

Urutan tahap ini yang menjamin entry kamus eksplisit tidak pernah tertimpa hasil rekonstruksi. Kalau `nulis` sudah tersimpan sebagai entry sendiri, tahap pertama sudah menangkapnya dan tahap ketiga tidak pernah melihat token itu.

Satu match hasil pelepasan imbuhan bisa mencakup lebih dari satu token, dari dua arah sekaligus: ke belakang kalau entry kamusnya berupa frasa (`anak keduaku`), dan ke depan kalau bentuk imbuhannya multi-kata (`agaminipun kula`, khusus `jv-id`). Semua token yang dikonsumsi ditandai di `covered` supaya tidak diproses ulang, dan pelepasan dibatalkan kalau token yang dibutuhkan sudah dipakai match lain.

## Index stem untuk pelepasan imbuhan

Selain dua automaton, `Translator` menyimpan dua map lookup:

| Index | Isi | Dipakai untuk |
|---|---|---|
| `forwardStems` | frasa Jawa → entry | verifikasi kata dasar Jawa saat arah `jv-id` |
| `reverseStems` | frasa Indonesia → entry | verifikasi kata dasar Indonesia saat arah `id-jv` |

Keduanya instance `StemIndex`, yang mengunci setiap frasa pada **kata terakhirnya**. Alasannya: imbuhan selalu menempel di kata terakhir, jadi setelah sufiks dilepas dari `keduaku` menjadi `kedua`, yang dibutuhkan adalah semua frasa yang berakhir dengan `kedua` — termasuk `anak kedua`, bukan cuma entry satu kata. Lookup-nya tetap O(1); kandidat yang didapat lalu dicocokkan kata-kata depannya terhadap token sebelumnya lewat `resolvePhrase()`.

Kandidat disimpan terurut frasa terpanjang dulu, jadi kandidat pertama yang cocok adalah yang paling greedy — konsisten dengan aturan leftmost-longest di automaton. `resolvePhrase()` juga menolak kandidat yang butuh token yang sudah tercakup match lain.

Bentuk imbuhan untuk arah `jv-id` (`JAVANESE_AFFIX_FORMS` di `affixes.ts`) diturunkan otomatis dari `SUFFIX_RULES` saat module dimuat, diurutkan terpanjang dulu. Jadi rule tetap ditulis sekali dan dipakai dua arah — tidak ada tabel kedua yang harus disinkronkan manual.

## Sinonim tidak mencampur tingkatan

Untuk arah `id-jv`, `meanings` berisi sinonim Jawa dari vocabulary **lain** yang punya arti Indonesia sama, bukan bentuk-bentuk dari tingkatan lain dalam satu entry. Alasannya: `aba` (ngoko) dan `titah` (krama) itu kata yang sama dalam register berbeda, bukan dua pilihan setara, jadi menampilkannya bersamaan membuat dropdown mencampur tingkatan.

Implementasinya memanfaatkan sifat `AhoCorasick.search()` yang mengembalikan semua payload untuk key yang sama. Entry-entry yang share meaning otomatis muncul di span yang identik, jadi tinggal difilter berdasarkan `start`/`end` yang sama, lalu semuanya dirender di tingkatan yang sudah ditentukan.

## Caching dan reload

`translator-store.ts` menyimpan satu instance `Translator` di memori. Membangun automaton jauh lebih mahal dibanding melayani satu request, jadi dibangun sekali lalu dipakai terus.

`POST /reload` membaca ulang database, membangun `Translator` baru, dan menukarnya. Penukarannya di akhir proses, jadi request yang masuk selama rebuild masih dilayani automaton lama.

## Performa

Semua angka di bawah dari mesin pengembangan, kamus sintetis 5.000 vocabulary (20% berupa frasa). Anggap sebagai gambaran besaran, bukan patokan mutlak.

**Per request** — sub-milidetik untuk ukuran normal:

| Panjang input | `id-jv` | `jv-id` |
|---|---|---|
| 10 kata | 0,016 ms | 0,031 ms |
| 40 kata | 0,020 ms | 0,047 ms |
| 150 kata | 0,072 ms | 0,148 ms |
| 500 kata | 0,182 ms | 0,424 ms |

Arah `jv-id` konsisten ~2x lebih lambat karena pass imbuhannya perlu lookahead dan pencocokan frasa ke belakang.

**Boot / reload** — di sinilah biaya sebenarnya:

| Kamus | Waktu bangun automaton |
|---|---|
| 1.000 vocab | ~50 ms |
| 4.000 vocab | ~147 ms |
| 16.000 vocab | ~583 ms |

Linear terhadap jumlah pattern. Mayoritasnya ada di `AhoCorasick.build()` milik library (272 ms dari 583 ms pada 16k vocab), bukan di kode sini. Karena hanya terjadi saat boot dan `POST /reload`, ini tidak menyentuh latensi request — tapi berarti `/reload` pada kamus besar menahan satu event loop cukup lama, jadi jangan dipanggil per-perubahan saat import massal; cukup sekali di akhir.

**Kompleksitas.** Kedua arah linear terhadap panjang input. Dua tempat pernah kuadratik dan sudah diperbaiki:

- Pass imbuhan `jv-id` dulu memanggil `tokens.slice(index + 1)` untuk setiap token yang tidak match, mengalokasikan array sepanjang sisa input. Sekarang lookahead-nya dibatasi `MAX_AFFIX_LOOKAHEAD`, yang diturunkan dari bentuk imbuhan terpanjang di tabel rule (saat ini 1 kata).
- `translateIdToJv` dulu memfilter seluruh array match untuk setiap match terpilih demi mengumpulkan sinonim. Sekarang dikelompokkan per span sekali jalan sebelum loop.

Dampaknya pada input 3.200 kata dengan semua token berimbuhan: 82 ms → 6,5 ms.

`tests/performance.test.ts` menjaga sifat linear ini. Test-nya memeriksa **rasio** waktu antara input n dan 2n, bukan milidetik absolut, supaya tetap bermakna di mesin CI yang lebih lambat: linear ≈ 2x, kuadratik ≈ 4x, batasnya 3x.

## Dependency

- [`mysql2`](https://www.npmjs.com/package/mysql2) — driver MySQL. Bun `Bun.sql` hanya mendukung Postgres, jadi tidak bisa dipakai di sini.
- [`modern-ahocorasick`](https://www.npmjs.com/package/modern-ahocorasick) — implementasi Aho-Corasick, dibungkus jadi token-based seperti dijelaskan di atas.

## Testing

```bash
bun test
```

Semua test memakai fixture in-memory, tidak butuh koneksi database. Ini mungkin karena `buildDictionaryFromRows()` dan `Translator` sama-sama menerima data biasa, bukan mengambil sendiri dari database.

| File | Cakupan |
|---|---|
| `normalize.test.ts` | normalisasi surface form |
| `builder.test.ts` | transform rows → Dictionary, dua arah |
| `aho-corasick.test.ts` | automaton token-based, batas kata |
| `affixes.test.ts` | rule imbuhan akhir dua arah, alomorf, deteksi level |
| `prefixes.test.ts` | rule awalan meN- / ater-ater, peluluhan, kandidat kata dasar |
| `translator.test.ts` | penerjemahan end-to-end, frasa, round trip, prioritas kamus |
| `performance.test.ts` | penjaga kompleksitas linear (lihat bagian Performa) |
