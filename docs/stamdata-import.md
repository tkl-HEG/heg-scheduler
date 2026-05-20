# Stamdata-import

`scripts/import-stamdata.mjs` samler grunddata fra den eksisterende prototype og Excel-arket med lærerkompetencer/fagfordeling. Scriptet er lavet til at kunne køres som dry-run først, så vi kan godkende mappingen før data skrives til Supabase.

## Kilder

Scriptet læser som standard:

- `seed-data.js` fra projektroden.
- `Databaser lister til skemalægning lærerkompetencer.xlsx`, hvis filen findes i workspace eller på den kendte Skrivebord-sti.

Hvis den officielle Excel-fil ikke findes, falder scriptet tilbage til testfilerne i projektroden (`_test_lærerkompetencer.xlsx` eller `_test.xlsx`).

## Dry-run

Fra projektroden:

```bash
node scheduler-v2/scripts/import-stamdata.mjs --dry-run
```

Fra `scheduler-v2`:

```bash
node .\scripts\import-stamdata.mjs --dry-run
```

Dry-run viser antal fundne lærere, hold, lokaler, fag, kompetencer, aktive uger, fagkrav, fagudbud, fagfordelinger, sammenlæsningsgrupper og warnings. Den viser også 20 eksempler på lærere, hold, fagudbud og warnings.

## Import-rækkefølge

Når importen senere køres rigtigt, skal rækkefølgen være:

1. `data_imports`
2. `campuses`
3. `teachers`
4. `course_subjects`
5. `rooms`
6. `class_groups`
7. `class_active_weeks`
8. `teacher_competencies`
9. `subject_pairing_groups`
10. `subject_offerings`
11. `education_requirements`
12. `teaching_assignments`
13. `teacher_suggestions`
14. `import_warnings`

Scriptet opretter ikke skemabrikker. Officielle hovedforløb og generelle kalenderbegivenheder ligger fortsat i deres egne kalendertabeller, indtil vi senere vælger hvordan de skal omsættes til egentlige bookinger.

## Mapping

### Lærere

`seed-data.js` er primær kilde til lærere. Prototypens `teachers[].id` gemmes som `legacy_id`, og `teachers[].name` bruges som initialer.

Excel-arket kan supplere med lærere, som kun findes som kolonneoverskrifter i fagfordeling. Det sker fx for en lærerinitial som `LHV`, hvis initialen findes i fagfordelingsarket men ikke i seed-data.

### Lærerkompetencer

Kompetencer læses både fra `teachers[].skillDetails[]` og arket `Lærerkompetencer`.

Mapping:

- `x` eller `X` bliver `primary`.
- `(x)` bliver `secondary`.
- Tekst med `cert` bliver `certified`, så den passer til enum-udvidelsen i migration 002.

Fag normaliseres til `course_subjects.normalized_key`, så fx samme fag ikke oprettes flere gange.

### Hold og kategorier

Hold læses primært fra `seed-data.js`. Excel-arket bruges som supplement, men dubletter på samme holdnavn undgås.

Foreløbig kategorimapping:

| Holdtekst | Kategori/program |
|---|---|
| GF1 | `gf1` / `gf1` |
| GF2 | `gf2` / `gf2` |
| Studenteråret | fælles STÅ-forløb: målprogram `staa`, kohorte (`staa1`/`staa2`) kun som metadata/review |
| EUS5 | foreløbigt `gf2` / `gf2`, med warning |
| Bl. detail | `detail` / `hovedforloeb_detail` |
| Ikea detail | `detail_ikea` / `hovedforloeb_detail_ikea` |
| Ikea logistik | `logistik` / `hovedforloeb_logistik`, med warning |
| Handel | `handel` / `hovedforloeb_handel` |
| Offentlig administration, Kontor, Kontor økonomi | `administration` / `hovedforloeb_administration` |

Usikre mappings gemmes som `import_warnings`, så de kan vurderes før rigtig import.

STÅ er en særlig case: `STÅ1` og `STÅ2` er forskudte kohorter af samme studenterårsforløb, ikke to helt adskilte uddannelser. Migration 007 opretter derfor et fælles `staa` education program og en fælles `staa` class category. Stamdata-importen må ikke hårdkode `Studenteråret Aars` eller `Studenteråret Hobro` til `staa1`; de mappes til fælles `staa`, mens `cohort_type`, `cohort_label` og mulige kohorter (`staa1`, `staa2`) gemmes til senere afklaring. Hvis kohorten ikke kan udledes sikkert af Excel, oprettes en warning.

Fagudbud for Studenteråret får desuden en `combined_teaching_group_key` i metadata. Den kan senere bruges til at sammenlæse STÅ1/STÅ2-fag via `subject_pairing_groups` eller en egentlig `combined_teaching_group`, uden at eksamensperioder, projektperioder, EOP/EO-forløb og vigtige datoer blandes sammen.

### Aktive uger

`classes[].activeWeeks[]` bliver til `class_active_weeks`. Excel-arket `Kalender` kan bruges som supplement, men seed-data er den stabile prototypekilde.

### Fag og fagkrav

`subjects[]` bliver til konkrete `subject_offerings`.

For hvert fagudbud dannes også et udkast til `education_requirements`:

- `total_hours` fra prototypens fag.
- `weekly_hours` beregnes som `total_hours / period_value`, når timer findes.
- `min_modules_per_week` og `max_modules_per_week` udledes forsigtigt fra 3-timers moduler.
- `required_weeks` hentes senere fra holdets aktive uger ved rigtig import.
- `requires_primary_competency` sættes til `true`.

Dette er grundlaget for den senere generator: kravene beskriver, hvad holdet skal have, mens fagudbud og fagfordeling viser, hvad der konkret er sat op.

### Fagfordeling og flere lærere

Arket `Fagfordeling Aars` og `Fagfordeling Hobro` læses som konkrete fagfordelinger. En markering på et fag og en lærer kobles til alle matchende fagudbud på den relevante adresse/campus.

Flere lærere på samme hold/fag gemmes som flere rækker i `teaching_assignments` med:

- `assignment_order`
- `share_fraction`
- rolle i metadata

Det bevarer muligheden for 1, 2 eller flere undervisere på samme fag.

### Forslag til lærere

`subjects[].suggestedTeacherIds[]` bliver til `teacher_suggestions`. De er ikke det samme som fagfordeling; de er forslag baseret på kompetencer/prototype.

### Warnings

Scriptet gemmer warnings for bl.a.:

- usikker holdkategori
- hold uden aktive uger
- fag uden timetal
- fag uden fagfordeling
- fagfordelt lærer uden registreret kompetence
- ukendt lærer/fag/hold
- lokaler uden adresse

Warnings er bevidst en del af importen: Excel-filen er startgrundlag, men data skal senere kunne rettes direkte i programmet.

## Manuel stamdatarettelse 009

Migration `009_add_lsss_jhm_teachers.sql` tilføjer to manuelle stamdatarettelser efter importen:

- `LSSS` / `Selvstudium` oprettes som pseudo-lærer/ressource i `teachers.metadata`. Den skal senere kunne bruges til selvstudium i fagfordeling og skema uden at booke en rigtig lærer.
- `JHM` / `Jens Peter Hartvig Madsen` oprettes som almindelig lærer.

Hvis faget `Arbejdsmarkedsparathed` findes i `course_subjects`, får `JHM` en `primary` lærerkompetence i faget. Hvis faget mangler, stopper migrationen ikke importen, men skriver en `notice`, så kompetencen kan tilføjes efter faget er oprettet.
