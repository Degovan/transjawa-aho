# API Reference

Semua endpoint menerima dan mengembalikan JSON.

## `POST /translate`

Request minimal:

```json
{ "text": "Klambiku abang" }
```

### Field request

| Field | Wajib | Default | Keterangan |
|---|---|---|---|
| `text` | ya | — | Teks yang diterjemahkan. |
| `direction` | tidak | `"jv-id"` | `"jv-id"` = Jawa → Indonesia. `"id-jv"` = Indonesia → Jawa. |
| `level` | tidak | `"ngoko"` | Hanya dipakai saat `direction: "id-jv"`. Tingkatan Jawa yang jadi hasil: `ngoko`, `krama`, atau `inggil`. Untuk `jv-id` field ini diabaikan, karena tingkatan input dideteksi sendiri dari kata dan bentuk imbuhannya. |

Nilai `direction` atau `level` di luar daftar di atas ditolak dengan HTTP 400. Request lama yang hanya mengirim `text` tetap jalan seperti sebelumnya.

### Field response

| Field | Kegunaan |
|---|---|
| `input` | Teks asli, dikembalikan apa adanya. |
| `output` | Kalimat hasil. Untuk `jv-id`, tiap kata Jawa diganti arti pertama; untuk `id-jv`, tiap kata Indonesia diganti bentuk Jawa pada `level` yang diminta. |
| `matches` | Daftar kata/frasa yang ketemu di kamus, dengan `start`/`end` berupa offset karakter di `input`. |
| `tokens` | Seluruh input dipecah jadi potongan berurutan. `match: null` berarti teks biasa, selain itu potongan yang diterjemahkan. |

Field di dalam tiap item `matches`:

| Field | Kegunaan |
|---|---|
| `source` | Potongan teks asli persis seperti di input, termasuk kapitalisasinya. |
| `translation` | Terjemahan yang dipakai di `output`. |
| `meanings` | Alternatif terjemahan di bahasa **output**, `translation` selalu di posisi pertama. Detail di bawah. |
| `level` | Untuk `jv-id`: tingkatan asal kata yang cocok — kalau hasil pelepasan imbuhan, tingkatan yang disimpulkan dari bentuk imbuhannya. Untuk `id-jv`: tingkatan yang benar-benar dipakai untuk `translation` (bisa beda dari yang diminta, lihat fallback di bawah). |
| `type` | Jenis kata dari kolom `type` tabel `vocabularies`, bisa `null`. |
| `vocabularyId` | ID entry vocabulary asalnya. |
| `start` / `end` | Offset karakter di `input`. |
| `affix` | Opsional, ada saat hasil berasal dari pelepasan imbuhan akhir (berlaku di kedua arah). `affix.suffix` adalah imbuhan yang dilepas dari input, `affix.stem` kata dasarnya. Lihat [imbuhan.md](imbuhan.md). |
| `prefix` | Opsional, ada saat hasil berasal dari rekonstruksi awalan `meN-` / `ater-ater`. `prefix.prefix` awalan yang dilepas, `prefix.stem` kata dasarnya. Lihat [awalan.md](awalan.md). Satu match tidak pernah punya `affix` dan `prefix` sekaligus. |

### Contoh: Jawa → Indonesia

```json
{ "text": "Klambiku abang" }
```

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
      "type": "sifat",
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

### Contoh: Indonesia → Jawa

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
      "type": "sifat",
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

## Isi `meanings` per arah

`meanings` selalu berisi alternatif di bahasa **output**, bukan bahasa input, dan `translation` selalu jadi elemen pertama.

**Arah `jv-id`** — semua arti Indonesia yang tersedia untuk entry tersebut, mengikuti urutan kolom `order` di tabel `meanings`:

```json
{ "source": "aba", "translation": "arahan", "meanings": ["arahan", "instruksi", "kode"] }
```

**Arah `id-jv`** — sinonim Jawa dari vocabulary lain yang punya arti Indonesia sama, **semuanya dirender di tingkatan yang sama** dengan `matches[].level`. Ini disengaja: dropdown tidak boleh mencampur tingkatan. Minta level `krama` untuk "perintah" mengembalikan bentuk krama saja:

```json
{ "source": "perintah", "translation": "titah", "meanings": ["titah", "dhawuh"], "level": "krama" }
```

Bentuk ngoko `aba` tidak muncul di situ, karena `aba` dan `titah` itu kata yang sama dalam tingkatan berbeda, bukan dua pilihan yang setara.

## Fallback tingkatan pada `id-jv`

Kalau tingkatan yang diminta kosong di database untuk entry tersebut, service tidak mengembalikan string kosong tapi jatuh ke tingkatan lain yang terisi, dengan prioritas ngoko → krama → inggil. `matches[].level` memberi tahu tingkatan yang benar-benar dipakai:

```json
{ "source": "tidur", "translation": "turu", "meanings": ["turu"], "level": "ngoko" }
```

Di contoh itu yang diminta `krama`, tapi kolom `krama` kosong sehingga dipakai `ngoko`. `meanings` juga mengikuti tingkatan hasil fallback, konsisten dengan aturan tidak mencampur tingkatan.

## Kapitalisasi

`source` mempertahankan teks asli persis seperti di input, termasuk huruf besarnya. Tapi `translation` dan `meanings` datang dari kamus yang sudah dinormalisasi jadi huruf kecil, jadi kata di awal kalimat akan kehilangan kapitalisasinya di `output`:

```json
{ "input": "Rumahnya merah", "output": "griyanipun abrit" }
```

Kalau frontend butuh kapitalisasi, tangani di sisi presentasi memakai `matches[].start` untuk tahu mana yang berada di awal kalimat.

## `tokens` bersifat lossless

Menggabungkan semua `token.text` mengembalikan input persis apa adanya, termasuk spasi dan tanda baca. Frontend bisa me-render kalimat utuh sambil menyisipkan dropdown tanpa menghitung offset sendiri:

```js
tokens.map(tok =>
  tok.match === null
    ? tok.text                                   // teks biasa
    : renderDropdown(tok.match.meanings)         // pilihan arti
);
```

## `POST /reload`

Rebuild kamus + automaton dari database. Panggil setelah ada data vocabulary/meaning baru.

```json
{ "status": "reloaded", "patternCount": 149, "loadedAt": "2026-08-01T05:54:35.366Z" }
```

## `GET /health`

```json
{ "status": "ok", "ready": true, "patternCount": 149, "loadedAt": "..." }
```

## Contoh curl

```bash
curl -s -X POST http://localhost:3001/translate \
  -H 'Content-Type: application/json' \
  -d '{"text":"Klambiku abang, aku arep adang sega."}'
```

```bash
curl -s -X POST http://localhost:3001/translate \
  -H 'Content-Type: application/json' \
  -d '{"text":"Rumahnya merah","direction":"id-jv","level":"krama"}'
```

```bash
curl -s -X POST http://localhost:3001/reload
curl -s http://localhost:3001/health
```
