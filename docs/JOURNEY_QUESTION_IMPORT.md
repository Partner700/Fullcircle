# Journey Question Import

Choose the character in Biblical Journey Questions, paste or open a JSON set, and select **Import questions**. Preview and the set name are optional.

- Upload 1-300 questions at a time, up to 2 MB. Smaller sets accumulate.
- Valid instructor uploads become active immediately. There is no second approval step.
- At least **200 distinct active questions per character** are required; exactly 200 is enough.
- Stages are assigned automatically in five balanced bands, ordered by difficulty and then import order. At 200, each stage has 40 questions. This is deterministic difficulty grouping, not automated interpretation of Bible chronology.
- A supplied `stage` is not required or used. Difficulty defaults to `moderate`.
- Duplicate prompts (case and whitespace ignored) do not increase the count. Faulty rows are skipped; valid rows are saved.
- Discontinuing a question keeps it in the bank but removes it from new games. Falling below 200 pauses new games. Restoring enough questions makes the character playable again.
- Existing matches retain their question pools when stages are redistributed.

```json
{
  "questions": [
    {
      "type": "multiple_choice",
      "question": "Who called Samuel by name at night?",
      "options": ["Eli", "The Lord", "Saul", "David"],
      "correct_answer": "The Lord",
      "reference": "1 Samuel 3:4",
      "difficulty_tag": "easy"
    }
  ]
}
```

Other supported types remain `true_false`, `odd_one`, `fill_blank`, and `order_sequence`. True/false has no options; sequence answers use each option letter once, such as `A C B`. Optional fields: `accepted_answers` and `explanation`.

## One-time reset

Release 209 permanently deletes all existing Journey questions, including pending, approved, rejected, and discontinued rows, for every character. It retains characters, accounts, other trivia banks, and match results. Finished-game question pointers are cleared so they do not prevent the deletion. A currently playing Journey match stops the reset; no match is cancelled or forfeited by the installer.

The release command first rehearses both migrations and behavioral database tests inside a rollback transaction. A failed rehearsal saves nothing. Migration history guards the actual reset so interrupted publication can resume without deleting replacement questions.

Local TypeScript and source tests run with `npm run test:journey`. PostgreSQL integration tests run with `PGLITE_MODULE=/path/to/pglite/dist/index.js node scripts/journey-bank-postgres.test.mjs`; this test-only dependency is not shipped in the app. The release command repeats the behavior checks in a rollback transaction against the actual target schema before applying anything.
