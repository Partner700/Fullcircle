/*
  The quote feeds resolve live streak values. Those streak functions can repair
  a snapshot while reading, so PostgreSQL must not execute the outer feeds as
  read-only STABLE functions. A read-only invocation failed with SQLSTATE 25006
  and the clients consequently rendered an empty Welcome Panel carousel.
*/

ALTER FUNCTION public.get_daily_quote_feed(integer) VOLATILE;
ALTER FUNCTION public.get_public_daily_quotes(date, integer) VOLATILE;

