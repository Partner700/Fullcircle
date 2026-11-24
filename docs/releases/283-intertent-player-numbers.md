# Release 283 — Player numbers on match cards

Each fixture shows the player's assigned Full Circle number directly below their profile picture in place of their display name. The number is live from the profile, not hard-coded. The existing championship endpoint returns only the assigned number for players in fixtures already accessible to the viewer; its permissions and camp scope are unchanged.

Deploy the tested `scripts/intertent-fixture-player-numbers.sql` as a migration before publishing the client. The dates, players, qualification, bookings, gameplay and standings are unchanged. The original name remains available for accessible avatar descriptions and instructor management.
