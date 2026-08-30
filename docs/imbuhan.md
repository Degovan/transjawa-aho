# Imbuhan (afiks) pada arah `id-jv`

Kamus hanya berisi kata dasar, jadi input berimbuhan seperti `agamanya` tidak akan cocok utuh dengan pattern apa pun. Untuk kasus ini imbuhannya dilepas dulu, kata dasarnya (`agama`) diterjemahkan lewat automaton, lalu imbuhan Jawa yang sepadan ditempel kembali sesuai `level` yang diminta.

Rule-nya ada di `src/matcher/affixes.ts` dan berbentuk data murni, jadi menambah imbuhan baru tidak perlu menyentuh matcher.

## Hasilnya

| Input | `level` | Output |
|---|---|---|
| `agamanya` | `ngoko` | `agamane` |
| `agamanya` | `krama` / `inggil` | `agaminipun` |
| `agamaku` | `ngoko` | `agamaku` |
| `agamaku` | `krama` / `inggil` | `agaminipun kula` |
| `agamamu` | `ngoko` | `agamamu` |
| `agamamu` | `krama` | `agaminipun sampeyan` |
| `agamamu` | `inggil` | `agaminipun panjenengan` |
| `rumahnya` | `ngoko` | `omahe` |
| `rumahnya` | `krama` | `griyanipun` |
| `rumahnya` | `inggil` | `dalemipun` |
| `rumahku` | `krama` | `griyanipun kula` |
| `rumahku` | `inggil` | `dalemipun kula` |

## Satu token bisa jadi beberapa kata

Ngoko punya sufiks terikat untuk kepemilikan orang pertama dan kedua (`-ku`, `-mu`), tapi krama tidak. Krama menandai kata bendanya sebagai definit (`-nipun` / `-ipun`) lalu menambahkan kata ganti lepas:

```
agamaku  (ngoko)  = agama + ku                    -> agamaku
agamaku  (krama)  = agami + nipun + kula          -> agaminipun kula
agamamu  (krama)  = agami + nipun + sampeyan      -> agaminipun sampeyan
agamamu  (inggil) = agami + nipun + panjenengan   -> agaminipun panjenengan
```

Kata gantinya tidak selalu sama antara krama dan inggil. Untuk orang kedua, `sampeyan` (krama) dan `panjenengan` (krama inggil) beda tingkat kehormatannya, jadi tiap tingkatan punya bentuknya sendiri. Untuk orang pertama, `kula` dipakai di krama maupun inggil.

Karena penempelan imbuhan cuma penggabungan string, bentuk multi-kata tidak perlu penanganan khusus — spasinya ditulis langsung di rule (`afterVowel: "nipun kula"`).

Konsekuensinya, satu token input bisa menghasilkan beberapa kata di `output`. `tokens` tetap lossless terhadap **input**, bukan output: satu potongan `tokens` yang berisi `agamaku` membawa `match.translation` bernilai `agaminipun kula`.

## Alomorf: bentuk imbuhan ikut huruf terakhir

Bentuk imbuhan Jawa menyesuaikan bunyi akhir kata dasar yang ditempeli, jadi tiap rule menyimpan dua varian:

| Kata dasar berakhir | ngoko | krama / inggil |
|---|---|---|
| vokal | `-ne` (`sega` → `segane`) | `-nipun` (`griya` → `griyanipun`) |
| konsonan | `-e` (`omah` → `omahe`) | `-ipun` (`sekul` → `sekulipun`) |

Yang menentukan adalah huruf terakhir **kata dasar Jawa hasil terjemahan**, bukan kata Indonesia-nya. Karena itu `rumahnya` di level ngoko jadi `omahe` (dari `omah`, konsonan) tapi di level krama jadi `griyanipun` (dari `griya`, vokal).

## Penanda di response

Kalau suatu match berasal dari pelepasan imbuhan, item di `matches[]` menyertakan field `affix`:

```json
{
  "source": "agamanya",
  "translation": "agamane",
  "meanings": ["agamane"],
  "level": "ngoko",
  "affix": { "suffix": "nya", "stem": "agama" }
}
```

| Field | Arti |
|---|---|
| `affix.suffix` | Imbuhan Indonesia yang dilepas dari input. |
| `affix.stem` | Kata dasar Indonesia yang dicari di kamus. |

Match biasa tidak punya field ini sama sekali.

## Pengaman supaya tidak salah potong

Dua aturan menjaga supaya pelepasan imbuhan tidak menghasilkan pemotongan ngawur:

**Kata dasar sisanya harus benar-benar ada di kamus.** Ini yang bikin `hanya` tidak dipecah jadi `ha` + `nya`, kecuali `ha` memang entry di kamus. Karena kamus sendiri yang jadi acuan, tidak ada risiko over-stemming pada kata yang di luar cakupan.

**Match kamus utuh selalu menang.** Pelepasan imbuhan hanya dicoba pada token yang tidak tercakup match apa pun. Jadi kalau `hanya` ada di kamus sebagai entry sendiri, itu yang dipakai, bukan hasil potongan.

## Tingkatan yang tidak diisi

Kalau suatu rule tidak punya entry untuk tingkatan yang diminta, tokennya dibiarkan apa adanya daripada dikarang jadi bentuk yang tidak wajar. Semua rule yang ada sekarang (`-nya`, `-ku`, `-mu`) sudah mengisi ketiga tingkatan, jadi kondisi ini belum terpakai — tapi tetap berlaku untuk rule baru yang memang tidak punya padanan di suatu tingkatan.

## Menambah rule baru

Tambah satu object ke `SUFFIX_RULES` di `src/matcher/affixes.ts`:

```ts
{
  suffix: "nya",                                        // sufiks Indonesia, tanpa tanda hubung
  javanese: {
    ngoko:  { afterVowel: "ne",    afterConsonant: "e" },
    krama:  { afterVowel: "nipun", afterConsonant: "ipun" },
    inggil: { afterVowel: "nipun", afterConsonant: "ipun" },
  },
  minStemLength: 2,
}
```

Kalau hasilnya perlu lebih dari satu kata, tulis spasinya di dalam bentuknya:

```ts
krama: { afterVowel: "nipun kula", afterConsonant: "ipun kula" },
```

Catatan:

- Array otomatis diurutkan sufiks terpanjang dulu saat module dimuat, jadi urutan penulisan tidak berpengaruh.
- Tingkatan yang tidak punya padanan cukup dihilangkan dari `javanese`, jangan diisi tebakan.
- `minStemLength` cuma pengaman sekunder; penjaga utamanya tetap keberadaan kata dasar di kamus.

## Kenapa tidak pakai Sastrawi

[`sastrawijs`](https://github.com/damzaky/sastrawijs) adalah port JavaScript dari Sastrawi PHP (algoritma Nazief-Adriani, lisensi MIT) dan kualitasnya bagus, tapi tidak pas untuk kebutuhan di sini:

**API-nya membuang informasi yang kita butuhkan.** `stem(word)` hanya mengembalikan kata dasar, tanpa memberi tahu imbuhan mana yang dilepas. Justru identitas imbuhan itu yang kita perlukan untuk memetakan `-nya` ke `-ne` atau `-nipun`.

**Kamus acuannya berbeda.** Sastrawi stemming berdasarkan kamus kata dasar Kateglo (~30 ribu kata), sementara tabel `vocabularies` di project ini yang jadi sumber kebenaran. Pakai kamus eksternal berarti kata di luar cakupan kita ikut di-stem, menghasilkan kata dasar yang toh tidak bisa diterjemahkan, plus menambah dependency dan data yang tidak terpakai.

Pendekatan yang dipakai di sini adalah pelepasan imbuhan yang dipandu kamus sendiri: lebih sempit cakupannya, tapi akurat untuk data yang benar-benar ada dan imbuhannya teridentifikasi.
