-- Scripture insights editorial corrections (2026-11-24).
-- Reader-facing prose must not attribute insight claims to secondary authors.
-- The source_titles bibliography remains untouched and appears in smaller text.
-- Interpret the present-day application from the passage itself, not against it.

with cleaned as (
 select reference,
 trim(regexp_replace(regexp_replace(spiritual_context,
  '(^|[.!?] +)[^.!?]*(Cahn|Joyner|Munroe)[^.!?]*[.!?] *',' ','gi'),
  '(^|[.!?] +)[^.!?]*(Cahn|Joyner|Munroe)[^.!?]*[.!?] *',' ','gi')) as text_clean
 from public.instructor_verse_contexts
 where spiritual_context ~* '(Cahn|Joyner|Munroe)'
)
update public.instructor_verse_contexts v
set spiritual_context=cleaned.text_clean, updated_at=now()
from cleaned
where v.reference=cleaned.reference and length(cleaned.text_clean)>=35;

update public.instructor_verse_contexts
set spiritual_context=case reference
 when 'Genesis 12:4' then 'Abram leaves the familiar because God calls him into a promise whose full outcome he cannot yet see. Faith begins in obedience, not in possession of every answer.'
 when 'Leviticus 25:10' then 'Jubilee proclaims release and restoration because the land and the people ultimately belong to God. His command restrains permanent dispossession and gives families the possibility of a new beginning.'
 when '1 Samuel 16:7' then 'God sees beyond appearance and public reputation. The choosing of David reminds us that a person may be overlooked by others yet known and appointed by the Lord.'
 when 'Genesis 11:4' then 'Babel reveals people seeking to make a name for themselves through united ambition. Unity is not righteousness merely because it is impressive; its purpose and allegiance matter.'
end,updated_at=now()
where reference in ('Genesis 12:4','Leviticus 25:10','1 Samuel 16:7','Genesis 11:4');

update public.instructor_verse_contexts
set historical_context='Judges names the spring of Harod and the Midianite camp in the Jezreel Valley. The location belongs to the real geography of northern Israel; no archaeological discovery establishes the exact size of Gideon''s army.',
lexical_note='The Hebrew word for boasting here is pa''ar: Israel must not claim the victory as its own achievement.',
evidence_note='The region and its ancient settlement history are independently known. The figure of 300 soldiers and the claimed divine purpose come from the biblical account.',
spiritual_context='God expressly reduces the army so Israel cannot say, "My own hand has saved me." The point is not to belittle Gideon as a leader, but to reveal the Lord as Israel''s deliverer. Gideon is honored for obedience; the victory belongs to God.',
present_day_context='Celebrate the people God uses, including founders and leaders, without confusing His servants with the source of the victory. When success comes, give God the glory, acknowledge those who served faithfully, and refuse to make numbers or personal ability your confidence.',
updated_at=now()
where reference='Judges 7:2';

update public.instructor_verse_contexts
set spiritual_context='God promises to save Israel through the three hundred. The surprising smallness of the force directs attention to His power and faithfulness rather than the strength of an army.',
present_day_context='Do not measure what God can accomplish solely by your resources or headcount. Obey the assignment with the people entrusted to you, and give Him the glory for the result.',
updated_at=now()
where reference='Judges 7:7';

update public.instructor_verse_contexts
set spiritual_context='The battle cry names both the Lord and Gideon. Scripture can recognize the servant God appointed while still making the Lord the source of deliverance.',
present_day_context='Honor faithful leadership without making leaders objects of worship. Let every achievement point back to the God who commissioned and sustained the work.',
updated_at=now()
where reference='Judges 7:18';

update public.instructor_verse_contexts
set spiritual_context='Jehu was an actual ruler of Israel: Assyrian evidence bears his name. The biblical account also presents his royal commission, which invites serious reflection on the difference between receiving authority and using it faithfully.',
updated_at=now() where reference='2 Kings 9:6';

update public.instructor_verse_contexts
set spiritual_context='The Davidic promise extends beyond a single building or reign. God declares that David''s royal house will endure; Christian faith understands this promise as reaching its fulfillment in Jesus Christ.',
updated_at=now() where reference='2 Samuel 7:16';
