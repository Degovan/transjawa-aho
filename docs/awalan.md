# Awalan (prefiks) meN- dan ater-ater

Kata berawalan seperti `menulis` ditangani dengan pola yang sama seperti [imbuhan akhir](imbuhan.md): kata dasarnya (`tulis`) dicari di kamus, diterjemahkan, lalu awalan padanannya dipasang di hasil.

| Arah | Contoh |
|---|---|
| `id-jv` | `menulis` → `tulis` → `nulis` (ngoko) / `nyerat` (krama, dari `serat`) |
| `jv-id` | `nulis` → `tulis` → `menulis` |

Rule-nya ada di `src/matcher/prefixes.ts`, terpisah dari `affixes.ts` karena strateginya berbeda secara mendasar (lihat bagian peluluhan di bawah).

## Kamus selalu diperiksa dulu

Karena sebagian entry di database sudah berupa bentuk berawalan (`nulis` sebagai entry sendiri) dan sebagian hanya kata dasar, urutan pemrosesannya:

1. **Match kamus utuh** — kalau `nulis` ada sebagai entry, itu yang dipakai.
2. **Imbuhan akhir** — `agamane`, `agaminipun kula`.
3. **Awalan** — baru di sini `menulis` direkonstruksi dari `tulis`.

Jadi entry eksplisit di kamus tidak pernah tertimpa hasil rekonstruksi. Kalau `nulis` sudah tersimpan dengan arti sendiri, arti itulah yang keluar, dan `matches[]` tidak akan punya field `prefix`.

## Aturan meN- (bahasa Indonesia)

Mengikuti Chaer (2002), `meN-` punya enam alomorf yang dipilih dari huruf awal kata dasar:

| Bentuk | Kata dasar diawali | Contoh |
|---|---|---|
| `me-` | r, l, w, y, m, n, ng, ny | rawat → merawat |
| `mem-` | b, f, v | baca → membaca |
| `men-` | c, d, j | cuci → mencuci |
| `meng-` | vokal, g, h, kh | ambil → mengambil |
| `meny-` | s (luluh) | sikat → menyikat |
| `menge-` | kata satu suku kata | bom → mengebom |

Konsonan **k, t, s, p luluh** (hilang) saat diberi awalan:

```
tulis    → menulis      (t hilang)
sikat    → menyikat     (s hilang)
pesona   → memesona     (p hilang)
konsumsi → mengonsumsi  (k hilang)
```

Kecuali kalau konsonan itu berada dalam kluster, maka tetap bertahan:

```
proses  → memproses    (bukan memoses)
praktik → mempraktik
kritik  → mengkritik
```

## Aturan ater-ater anuswara (bahasa Jawa)

Awalan nasal `m-`, `n-`, `ny-`, `ng-`:

| Kata dasar diawali | Hasil | Contoh |
|---|---|---|
| b | `mb-` | buru → mburu |
| p, w (luluh) | `m-` | pangan → mangan, wulang → mulang |
| d, dh, j | `nd-`, `ndh-`, `nj-` | dudut → ndudut, jupuk → njupuk |
| t, th (luluh) | `n-` | tulis → nulis, tandur → nandur |
| c, s (luluh) | `ny-` | cukil → nyukil |
| vokal, g, r, l | `ng-` | rasa → ngrasa |
| k (luluh) | `ng-` | kuras → nguras |

Perhatikan pola peluluhannya mirip dengan bahasa Indonesia — k, t, s, p sama-sama luluh di kedua bahasa.

## Peluluhan bikin arah balik ambigu

Ini beda mendasar dengan imbuhan akhir. Melepas sufiks itu pemotongan biasa: `agamane` minus `ne` pasti `agama`. Tapi melepas awalan tidak bisa begitu, karena konsonan awal kata dasarnya sudah **hilang**:

```
nulis  bisa dari "ulis"  (tidak ada yang luluh)
       atau dari "tulis" (t luluh)

mangan bisa dari "angan"  (tidak ada yang luluh)
       atau dari "pangan" (p luluh)
```

Bentuk permukaannya saja tidak cukup untuk menentukan. Karena itu pendekatannya bukan memotong, tapi **membangkitkan semua kandidat kata dasar** yang mungkin, lalu kamus yang memutuskan mana yang benar:

- Kalau cuma `tulis` yang ada di kamus, itu yang dipakai.
- Kalau cuma `ulis` yang ada, `ulis` yang dipakai.
- Kalau dua-duanya ada, yang dipilih adalah kandidat dengan konsonan dipulihkan (`tulis`), karena itu bacaan yang lebih panjang — konsisten dengan aturan leftmost-longest di bagian lain sistem ini.
- Kalau tidak ada yang cocok, token dibiarkan apa adanya.

Penanda awalan juga dicoba dari yang terpanjang, supaya `mengambil` tidak salah dibaca sebagai `me` + `ngambil`.

## Ater-ater tidak menandai tingkatan

Berbeda dengan sufiks kepemilikan (`-ne` menandakan ngoko, `-nipun` menandakan krama), awalan nasal Jawa **sama di semua tingkatan**. `nulis` dan `nyerat` dua-duanya pakai pola yang sama; yang membedakan tingkatannya adalah kata dasarnya (`tulis` ngoko vs `serat` krama), bukan awalannya.

Konsekuensinya, untuk arah `jv-id`, `matches[].level` diambil dari kolom tingkatan kata dasar itu di kamus, bukan disimpulkan dari awalannya.

## Penanda di response

Match hasil rekonstruksi awalan menyertakan field `prefix`:

```json
{
  "source": "menulis",
  "translation": "nulis",
  "meanings": ["nulis"],
  "level": "ngoko",
  "prefix": { "prefix": "men", "stem": "tulis" }
}
```

| Field | Arti |
|---|---|
| `prefix.prefix` | awalan permukaan yang dilepas dari input |
| `prefix.stem` | kata dasar yang dicari di kamus |

Field ini terpisah dari `affix`, jadi frontend bisa membedakan mana hasil imbuhan akhir dan mana hasil awalan. Satu match tidak pernah punya keduanya sekaligus.

## Batasan

**Awalan hanya untuk kata tunggal.** Berbeda dengan sufiks yang bisa menempel di kata terakhir sebuah frasa (`anak keduaku`), rekonstruksi awalan hanya mencoba kata dasar satu kata. Awalan verbal secara alami menempel pada satu kata, bukan pada kepala frasa.

**Tidak dikombinasikan dengan sufiks.** Bentuk yang berawalan **dan** berakhiran sekaligus (`menuliskannya`) belum ditangani; yang dicoba adalah salah satu saja. Kalau ini dibutuhkan, perlu tahap gabungan yang melepas keduanya lalu memvalidasi kata dasar di tengah.

**`menge-` belum diimplementasikan.** Alomorf untuk kata dasar satu suku kata (`bom` → `mengebom`) ada di referensi tapi belum dipasang, karena butuh pemenggalan suku kata yang keandalannya perlu diuji terhadap data nyata dulu.

**Pengecualian leksikal tidak ditangani.** Kasus seperti `kaji` → `mengkaji` (bukan `mengaji`, yang punya arti berbeda) adalah pengecualian per-kata, bukan pola. Kalau kata seperti ini muncul di kamus, cara paling tepat adalah menyimpan bentuk berawalannya sebagai entry sendiri — dan karena kamus selalu diperiksa lebih dulu, entry itu otomatis menang atas rule.

## Menambah atau mengubah rule

Tabel `INDONESIAN_PREFIX_FORMS` dan `JAVANESE_PREFIX_FORMS` di `src/matcher/prefixes.ts` berbentuk data:

```ts
{ initials: ["t"], prefix: "men", dropsInitial: true },   // tulis -> menulis
{ initials: ["b"], prefix: "m",   dropsInitial: false },  // buru  -> mburu
```

| Field | Arti |
|---|---|
| `initials` | huruf/gabungan huruf awal kata dasar yang cocok dengan rule ini |
| `prefix` | awalan yang dipasang |
| `dropsInitial` | `true` kalau konsonan awal kata dasar luluh |

Dua catatan:

- Digraf (`dh`, `th`, `ng`, `ny`, `kh`) harus ditulis **sebelum** huruf tunggal yang jadi awalannya, supaya pencocokannya greedy.
- Tabel arah balik dibangkitkan otomatis dari tabel maju ini, jadi cukup mengubah satu tempat dan kedua arah ikut menyesuaikan.

## Referensi

- Chaer, Abdul. 2002. *Morfologi Bahasa Indonesia*. Jakarta: PT Rineka Cipta — sumber untuk enam alomorf `meN-`.
- Aturan *ater-ater anuswara* (am-, an-, any-, ang- → m-, n-, ny-, ng-) sebagaimana diajarkan dalam tata bahasa Jawa, dengan contoh `am + buru = mburu`, `an + tulis = nulis`, `any + cukil = nyukil`, `ang + kuras = nguras`.
