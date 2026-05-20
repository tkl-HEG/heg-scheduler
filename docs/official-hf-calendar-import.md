# Officiel Hovedforløbskalender

Filen `Kalender 2023-2028 nyt forslag.xlsx` behandles som officiel hovedforløbskalender. Den skal importeres før almindelig skemagenerering, fordi hovedforløb ikke skal flyttes frit af generatoren.

## Hvad Importeres

Migration `005_official_hf_calendar_schema.sql` tilføjer:

- `official_hf_calendar_imports`: én række pr. officiel Excel-import.
- `official_hf_calendar_entries`: strukturerede kalenderceller med dato, uge, tekst, kategori, lærerinitialer og match til program/kategori.
- `lesson_bookings.official_hf_calendar_entry_id`: sporbarhed fra senere låste skemabrikker tilbage til officiel kalender.
- Views til ugevisning, unmatched poster og lærerbelastning.

Når officielle kalenderposter senere omsættes til skemabrikker, bør de oprettes som:

- `source = official_hf_calendar`
- `locked = true`
- `official_hf_calendar_entry_id = <entry id>`

Generatoren skal derefter planlægge GF/øvrige fag uden om disse låste hovedforløbsbookinger.

## Parserens Antagelser

Scriptet `scripts/import-official-hf-calendar.mjs` gør bevidst konservative antagelser:

- Kun ark med navne som `2023`, `2023 (2)`, ..., `2028`, `2028 (2)` læses.
- Månedblokke findes ved celler med danske månedsnavne som `Januar`, `Februar`, `Marts` osv.
- Rækker under en månedsoverskrift betragtes som kalenderdage, hvis de indeholder et dagnummer eller en rigtig Excel-dato tæt på månedens startkolonne.
- Ugedag og uge læses fra celler tæt på datoen, hvis de findes. Ellers beregnes ISO-uge og ugedag ud fra datoen.
- Tomme celler, rene dato-/uge-/ugedagsceller og forklaringsrækker uden dato ignoreres.
- Hver relevant tekstcelle gemmes som én kalenderpost. Hvis en celle har flere linjer, bevares teksten samlet som `raw_text`.
- Lærerinitialer udtrækkes fra parenteser, fx `(JAT/TKL)`.
- Kategori forsøges først udledt fra kategori-labels i samme kolonne, derefter fra selve tekstindholdet.
- Kendte kategorier forsøges matchet til seedede `education_programs` og `class_categories`.

Parseren er ikke en skemalægger. Den importerer et struktureret grundlag og opretter warnings, hvor formatet ikke kan forstås sikkert.

## Kategorimatch

Følgende officielle kategori-/uddannelsestyper forsøges matchet:

| Kalendertekst | Education program | Class category |
|---|---|---|
| IKEA detail / detail Ikea | `hovedforloeb_detail_ikea` | `detail_ikea` |
| Logistik | `hovedforloeb_logistik` | `logistik` |
| Blandet detail / detail | `hovedforloeb_detail` | `detail` |
| Handel | `hovedforloeb_handel` | `handel` |
| Administration / Off. Adm / Økonomi | `hovedforloeb_administration` | `administration` |
| Valgfag | Ikke fast matchet endnu | Ikke fast matchet endnu |

Poster uden match kan findes i viewet `v_official_hf_calendar_unmatched`.

## Dry-Run

Dry-run kræver ikke Supabase:

```bash
node scheduler-v2/scripts/import-official-hf-calendar.mjs "Kalender 2023-2028 nyt forslag.xlsx" --dry-run
```

Dry-run viser:

- antal ark læst
- antal kalenderposter fundet
- antal poster pr. år
- antal poster pr. kategori
- antal unmatched
- 10 eksempler på parsed entries
- 10 eksempler på warnings

## Rigtig Import

Rigtig import kræver Supabase REST-adgang. Brug service role key til importjobbet, fordi der skrives til flere tabeller med RLS:

```bash
set SUPABASE_URL=https://your-project.supabase.co
set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
node scheduler-v2/scripts/import-official-hf-calendar.mjs "Kalender 2023-2028 nyt forslag.xlsx"
```

Standardværdier:

- `ORGANIZATION_SLUG=heg`
- `SCHOOL_SLUG=heg`

De kan overskrives:

```bash
node scheduler-v2/scripts/import-official-hf-calendar.mjs "Kalender 2023-2028 nyt forslag.xlsx" --organization-slug heg --school-slug heg
```

## Idempotens

Importen er idempotent på to niveauer:

- `official_hf_calendar_imports` bruger `school_id + filename + calendar_year_start + calendar_year_end`.
- `official_hf_calendar_entries` bruger `import_id + sheet_name + cell_address + raw_text`.

Det betyder, at samme fil kan køres igen uden at lave dubletter af kalenderposter.

## Warnings

Scriptet opretter `import_warnings`, når det ikke kan udlede kategori, uddannelsesprogram eller holdkategori sikkert. Warnings er review-punkter, ikke nødvendigvis stopfejl.

Typiske warnings:

- manglende kategori
- ukendt uddannelsesprogram
- ukendt class category
- ark uden genkendelige månedsoverskrifter

## Planlægningskonsekvens

Officielle hovedforløb skal prioriteres først:

1. Importér officiel HF-kalender.
2. Review unmatched poster og warnings.
3. Omsæt relevante kalenderposter til låste `lesson_bookings`.
4. Kør almindelig generator for øvrige hold/fag uden om de låste bookinger.
