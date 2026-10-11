# transjawa-aho

Service penerjemah **Jawa ↔ Indonesia** menggunakan algoritma **Aho-Corasick**. Kamusnya dibaca langsung dari database MySQL aplikasi Trans Jawa (`transjawa-panel`), dimuat ke automaton di memori, dan diekspos sebagai HTTP API untuk dikonsumsi Laravel.

```
Laravel  --POST /translate {"text": "..."}-->  transjawa-aho  -->  JSON hasil
   |                                                 |
   +---------- MySQL trans_jawa <-- vocab/meanings ---+
```

Yang bisa dilakukan:

- Jawa → Indonesia, dan Indonesia → Jawa dengan pilihan tingkatan (`ngoko`, `krama`, `inggil`).
- Matching per kata, jadi `abang` tidak salah cocok di dalam `sembarang`, dan frasa multi-kata (`sega abang` → `nasi merah`) dicocokkan sebagai satu unit — termasuk saat berimbuhan (`anak keduaku` → `anak nomer loroku`).
- Kata berimbuhan tertangani di kedua arah: `agamanya` → `agamane` (ngoko) / `agaminipun kula` untuk `agamaku` (krama), dan sebaliknya `agaminipun kula` → `agamaku`.
- Kata berawalan juga: `menulis` → `nulis` (ngoko) / `nyerat` (krama), dan sebaliknya. Kamus selalu diperiksa dulu, jadi entry yang sudah tersimpan berawalan tidak tertimpa hasil rekonstruksi.
- Tiap hasil membawa daftar alternatif terjemahan, siap dipakai sebagai dropdown pilihan di frontend.

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

Untuk produksi, jaga proses Bun tetap hidup pakai systemd, pm2, atau supervisor.

## Endpoint

| Endpoint | Fungsi |
|---|---|
| `POST /translate` | Terjemahkan teks. Field: `text`, opsional `direction` dan `level`. |
| `POST /reload` | Rebuild kamus + automaton dari database. |
| `GET /health` | Status service dan jumlah pattern yang dimuat. |

Contoh cepat:

```bash
curl -s -X POST http://localhost:3001/translate \
  -H 'Content-Type: application/json' \
  -d '{"text":"Klambiku abang"}'
```

```bash
curl -s -X POST http://localhost:3001/translate \
  -H 'Content-Type: application/json' \
  -d '{"text":"Rumahnya merah","direction":"id-jv","level":"krama"}'
```

Bentuk request/response lengkap ada di [docs/api.md](docs/api.md).

## Integrasi Laravel

```php
use Illuminate\Support\Facades\Http;

$res = Http::post(config('services.transjawa_aho.url').'/translate', [
    'text' => 'Klambiku abang',
])->json();

// $res['output'] => "Klambiku merah"
// $res['tokens'] => dipakai frontend untuk render dropdown arti
```

Arah sebaliknya dengan tingkatan tertentu:

```php
$res = Http::post(config('services.transjawa_aho.url').'/translate', [
    'text'      => 'Rumahnya merah',
    'direction' => 'id-jv',
    'level'     => 'krama',
])->json();

// $res['output'] => "griyanipun abrit"
```

Saat ada vocabulary/meaning baru (misal dari observer atau setelah import), refresh cache automaton:

```php
Http::post(config('services.transjawa_aho.url').'/reload');
```

Simpan base URL-nya di `.env` Laravel supaya tidak hardcode:

```
TRANSJAWA_AHO_URL=http://127.0.0.1:3001
```

## Script

| Perintah | Fungsi |
|---|---|
| `bun run serve` | Jalankan server |
| `bun run dev` | Server dengan hot reload |
| `bun run check` | Tes koneksi MySQL, tampilkan daftar tabel |
| `bun run dict` | Build kamus dari DB, tampilkan contoh pattern |
| `bun test` | Jalankan test suite |

## Dokumentasi

| Dokumen | Isi |
|---|---|
| [docs/api.md](docs/api.md) | Referensi endpoint: semua field request/response, isi `meanings` per arah, fallback tingkatan. |
| [docs/imbuhan.md](docs/imbuhan.md) | Imbuhan akhir (`-nya`, `-ku`, `-mu`) di kedua arah, deteksi tingkatan dari bentuk imbuhan, cara menambah rule baru. |
| [docs/awalan.md](docs/awalan.md) | Awalan `meN-` dan `ater-ater anuswara`, aturan peluluhan, kenapa arah balik ambigu, batasan yang ada. |
| [docs/arsitektur.md](docs/arsitektur.md) | Struktur internal: pembangunan kamus, matching token-based, caching, angka performa, dependency. |
