# Release 284 — Opening fixture, live scores and countdowns

Match 1 now starts on the championship opening Sunday at 7 PM Cameroon time. The migration `scripts/intertent-sunday-opening-match.sql` changes the existing draft first fixture only if it is untouched, leaving the other 18 scheduled dates unchanged; future draft creation retains the Sunday opener.

The Cadet and Sentry welcome panels feature the current championship fixture, prioritizing live matches and then the next scheduled match. The Arena cards display second-by-second countdowns and refresh live game scores using the existing Arena score endpoint. Player numbers, tent groupings, qualification rules and advancement remain as before. Completed cards retain tournament points.

TypeScript, Arena matchup, inter-tent integration, mobile startup and production build checks passed. Actual live-game rendering uses existing scores and begins when a qualified match starts; no production game needs to be created for rollout verification.
