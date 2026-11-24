# Release 287 — Bible reading continuity

The Bible remembers the last selected book, chapter and reading scroll position per signed-in user and device. The Today's Reading shortcut opens the published passage at its starting verse or chapter, taking priority over the saved location; archived readings use their own passage. The Bible edition selection is remembered too. The Cadet and Sentry paths use the same reader.

Only the tournament welcome artwork receives a slight relative color correction (brightness −3, black point +3, white point −3). The Arena artwork, tournament records and other slides are unchanged. No database changes are required.

Checks include TypeScript, Bible reference parsing and local storage/account isolation, app continuation, mobile startup resilience and a complete production build.
