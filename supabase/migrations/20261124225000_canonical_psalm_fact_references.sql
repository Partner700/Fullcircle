-- Match the app's canonical Psalms book label so facts render in the Bible reader.
update public.scripture_did_you_know set reference=regexp_replace(reference,'^Psalm ','Psalms ') where reference like 'Psalm %';
