# Generel planlægningskalender

Dette dokument beskriver importen af GF1/GF2/STÅ-kalendere og dokumentet med vigtige datoer for efteråret 2026.

## Formål

`planning_calendar_events` er generelle planlægningsbegivenheder. De skal hjælpe generatoren med at forstå blockers, frister, milepæle og informationsdatoer.

De bliver ikke automatisk til `lesson_bookings`.

## Forskel på HF og planlægningskalender

`official_hf_calendar_entries` er officiel hovedforløbsdata. Hovedforløb skal importeres først, og når de senere bliver til bookinger, skal de som udgangspunkt være låste og ikke flytbare.

`planning_calendar_events` er bredere planlægningsdata for GF1, GF2, STÅ og administrative datoer. De kan påvirke generatoren som `info`, `warning`, `soft_block` eller `hard_block`, men de er ikke undervisningsbookinger i sig selv.

## Kilder

Scriptet `scripts/import-planning-calendars.mjs` læser som standard:

- `Udkast GF-1 efteråret 2026.xlsx`
- `Udkast GF-2 efteråret 2026 maj 2026.xlsx`
- `Udkast STÅ efteråret 2026.xlsx`
- `Vigtige datoer for efteråret 2026.docx`

Filerne kan ligge i projektroden, i `scheduler-v2` eller i brugerens `Downloads`-mappe. Der kan også angives eksplicitte stier med:

```bash
node scheduler-v2/scripts/import-planning-calendars.mjs --dry-run --gf1 "sti.xlsx" --gf2 "sti.xlsx" --staa "sti.xlsx" --important-dates "sti.docx"
```

## Excel-format

GF1/GF2/STÅ-filerne er kalenderark med måneder i blokke. Parseren leder efter rækker med flere månedsnavne og læser derefter:

- ugedag
- dag-i-måned
- kalendertekst
- beregnet dato og ISO-uge

Parseren ignorerer tomme celler, månedsnavne, ugedage, rene dag-/ugeceller og skabelonnoter som arbejdsdage.

## DOCX-format

DOCX-filen læses som tekstafsnit. Parseren bruger afsnitsoverskrifter som scope:

- Grundforløb 1
- Grundforløb 2
- Studenteråret
- Øvrige datoer for studenteråret
- Offentliggørelse af prøver

Datoer i august-december tolkes som 2026. Datoer i januar-juli tolkes som 2027 for efterårsperioden.

## Eventtyper og lock-level

Eksempler:

- `praktik`, `exam`, `terminsproeve`, `study_trip` -> `hard_block`
- `case_work`, `usf`, `eop`, `eo_assignment` -> typisk `soft_block`
- `grade_deadline`, `deadline`, eksamensudtræk og vigtige offentliggørelser -> `warning`
- almindelige aktiviteter som intro, erhvervsfag og 20 skarpe -> `info`

Alle events importeres med `should_create_booking = false`.

## Dry-run

Fra projektroden:

```bash
node scheduler-v2/scripts/import-planning-calendars.mjs --dry-run
```

Fra `scheduler-v2`:

```bash
node .\scripts\import-planning-calendars.mjs --dry-run
```

Dry-run viser:

- `files_read`
- `events_found`
- events fordelt på kilde, type, lock-level og uge
- `unmatched`
- `sample_events`
- `sample_warnings`

## Senere rigtig import

Rigtig import er ikke en del af første test. Når den aktiveres, kræver den:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Importen er idempotent med en stabil `dedupe_key` pr. event. Excel-events dedupes ud fra import, fil, ark, celle og tekst. DOCX-events dedupes ud fra import, fil, dato og tekst.

Rigtig import må kun skrive til:

- `planning_calendar_imports`
- `planning_calendar_events`
- `data_imports`
- `import_warnings`

Den må ikke oprette `lesson_bookings`.
