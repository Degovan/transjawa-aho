# Data Structure

## Vocabulary (`app/Models/Vocabulary.php`)

**Fillable fields:**
`ngoko`, `krama`, `inggil`, `type`, `audio`, `aksara`, `cover`, `title`, `description`, `keywords`

**Casts (array):**
`audio`, `aksara`, `cover`, `keywords`

**Observer:** `VocabularyObserver` (via atribut `#[ObservedBy]`)

**Relasi:**

| Method | Tipe | Target |
|---|---|---|
| `meanings()` | hasMany | `Meaning` |
| `contents()` | hasMany | `Content` |
| `examples()` | hasMany | `Example` |

## Meaning (`app/Models/Meaning.php`)

**Fillable fields:**
`language_id`, `vocabulary_id`, `meaning`, `synonim`, `ber_mean`, `ter_mean`, `pe_mean`, `parent_id`, `order`

**Relasi:**

| Method | Tipe | Target | Keterangan |
|---|---|---|---|
| `language()` | belongsTo | `Language` | |
| `vocabulary()` | belongsTo | `Vocabulary` | |
| `parent()` | belongsTo | `Meaning` | self-referencing via `parent_id` |
| `children()` | hasMany | `Meaning` | self-referencing via `parent_id` |

**Catatan:** `Meaning` bersifat hierarkis/nested lewat `parent_id` (parent ↔ children), dan tiap meaning terikat ke satu `Language` — satu vocabulary bisa punya arti dalam banyak bahasa yang tersusun bertingkat.
