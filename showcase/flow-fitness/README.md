# Showcase: the Flow Fitness catalogue imported (ADR-0022)

The Flow Fitness pilot (`D:\flow-fitness-qa`) designed and ran 376 cases against the Flow Fitness CRM. This
showcase imports that catalogue into the agent as it is: the pilot's requirement catalogue
(`src/requirements/catalogue.ts`) becomes five approved sources, one per kind (FR, BR, AC, DEC, NFR), and the
pilot's `docs/test-cases.csv` goes through `importCases`, approved.

```bash
npx tsx showcase/flow-fitness/import-catalogue.ts [path to flow-fitness-qa]
```

It writes `results/import-report.json` and `results/test-design.md`, the agent's design document built from the
imported records, to read beside the pilot's own `docs/test-design.md`.

| Run of 2026-10-27 | |
| --- | ---: |
| Rows | 376 |
| Imported (approved, codes kept) | 376 |
| Rejected | 0 |
| Re-import of the same file | 0 imported, 376 skipped |
| Catalogue ids a case cites by name | 384 of 386 (not BR-603, A-013; the pilot's own design document also lists BR-603) |
| Ids the registry cannot hold | 5 (`NFR-SEC` 25 cases, `API-ERR` 19, `API-LIST` 1, `NFR-A11Y` 1, `BR-402a` 1) |
| Techniques outside the agent's list | CRUD (12 cases), Random (2) |
| Cases whose expected results sit on the last step | 132 |
| Execution results not imported | 353 (a result needs a run record) |
| Observability check on the team's 983 expected results (held out, ADR-0023) | 159 flagged (16 %); the sample in `results/import-report.json` is nearly all false flags |

**The held-out measurement.** The team's expected results were never used to tune the observability check, so
what it flags here is its false-flag rate on human-written text: "Still on /login", "Payment status PARTIAL",
"Paid", "The lead gets an LD code" are all verifiable to someone who knows the product, and all flagged. The check
is lexical; it stays an advisory flag and was deliberately not tuned on this set.

The five unresolved ids are not mistakes in the pilot. Four name requirement areas rather than numbered
requirements, and the agent's identifiers (ADR-0005) end in a number; `BR-402a` has a lower-case suffix the
identifier pattern does not accept. They are flagged on the cases that cite them, so a reviewer sees which cases
rest on an id the registry does not carry.

**Two coverage measures.** `GET /api/coverage` counts an identifier as covered when any case cites the source that
carries it (ADR-0018). With one source per requirement kind that reads 490 of 490 here, which says little, so the
coverage view now also reports `identifiersNamed` and `gaps.identifiersNotNamed`: identifiers a case cites by name (379 of 490 here).
The 490 include ids that the requirement texts mention; the table above counts the catalogue's own 386.
