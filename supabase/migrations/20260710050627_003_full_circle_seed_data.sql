/*
# Full Circle Portal — Seed Reference Data

## Overview
Populates fixed reference tables with the five Tent Houses, relic types, and a set
of demo daily narratives (today + past week) so the app has content to display
immediately. Also adds a handle_new_user trigger to auto-create a profile row
when someone signs up.

## Data Inserted
- 5 tent_houses: The Squares, The Spades, The Darics, The Rudes, The Laureats
- 5 relic_types: Eliminate, Hint, Skip, Freeze Timer, Reveal Reference
- 7 daily_narratives: today and the past 6 days, with structured game_seed_data
- A trigger function + trigger that auto-creates a profiles row on auth.users insert
*/

-- ============================================================
-- TENT HOUSES
-- ============================================================

INSERT INTO tent_houses (id, name, symbol_icon, symbol_motif, color, motto) VALUES
('squares', 'The Squares', 'Square', 'The mason''s square — construction tool', '#4A90D9', 'Built on the level, rising true.'),
('spades', 'The Spades', 'Spade', 'The upper blade of a farming spade', '#6BAA52', 'Turn the soil, plant the seed.'),
('darics', 'The Darics', 'Coins', 'The gold Persian coin', '#D4A03C', 'Faith tested, proven as gold.'),
('rudes', 'The Rudes', 'Sword', 'The wooden sword awarded to a freed gladiator', '#B8553E', 'Trained for the arena, freed for the field.'),
('laureats', 'The Laureats', 'Crown', 'The crown won by a Roman athlete', '#8B6FB5', 'Press on for the prize.')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- RELIC TYPES
-- ============================================================

INSERT INTO relic_types (name, description, effect, rarity, denarii_cost, effect_scope, icon) VALUES
('Eliminate', 'Remove two wrong answers from a multiple-choice question.', 'eliminate', 'common', 2000, 'quiz_aid', 'X'),
('Hint', 'Reveal a contextual hint for the current question.', 'hint', 'common', 1500, 'quiz_aid', 'Lightbulb'),
('Skip', 'Automatically pass the current question without answering.', 'skip', 'rare', 5000, 'quiz_aid', 'Forward'),
('Freeze Timer', 'Pause the quiz countdown for 60 seconds.', 'freeze_timer', 'rare', 4000, 'quiz_aid', 'Clock'),
('Reveal Reference', 'Show the scripture reference behind the current question.', 'reveal_reference', 'epic', 8000, 'quiz_aid', 'BookOpen')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO profiles (id, display_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)), NEW.email);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- DEMO NARRATIVES (today + past 6 days)
-- ============================================================

INSERT INTO daily_narratives (narrative_date, title, theme, scripture_reference, main_text, highlighted_verses, reflection_prompts, challenge_title, challenge_instructions, game_seed_data)
VALUES
(
  CURRENT_DATE,
  'The Call to Discipleship',
  'Following Christ means leaving everything behind.',
  'Luke 5:1-11',
  'On one occasion, while the crowd was pressing in on him to hear the word of God, he was standing by the lake of Gennesaret. And he saw two boats by the lake, but the fishermen had gone out of them and were washing their nets. Getting into one of the boats, which was Simon''s, he asked him to put out a little from the land. And he sat down and taught the people from the boat. And when he had finished speaking, he said to Simon, "Put out into the deep and let down your nets for a catch." And Simon answered, "Master, we toiled all night and took nothing! But at your word I will let down the nets." And when they had done this, they enclosed a large number of fish, and their nets were breaking. They signaled to their partners in the other boat to come and help them. And they came and filled both the boats, so that they began to sink. But when Simon Peter saw it, he fell down at Jesus'' knees, saying, "Depart from me, for I am a sinful man, O Lord." For he and all who were with him were astonished at the catch of fish that they had taken. And so also were James and John, sons of Zebedee, who were partners with Simon. And Jesus said to Simon, "Do not be afraid; from now on you will be catching men." And when they had brought their boats to land, they left everything and followed him.',
  '[{"reference":"Luke 5:10","text":"Do not be afraid; from now on you will be catching men.","meditation":"Jesus calls ordinary working men to an extraordinary mission. The call comes with a promise and a command: do not be afraid."}]'::jsonb,
  '["What does it mean to leave everything and follow Christ?","What are the ''nets'' in your life that Jesus is asking you to leave behind?","When has Jesus asked you to ''put out into the deep''?"]'::jsonb,
  'The Deep Water Challenge',
  'Identify one area of comfort or security you are holding onto. Write a short commitment to release it to God this week.',
  '{"key_verse": {"reference": "Luke 5:10", "text": "Do not be afraid; from now on you will be catching men."}, "characters": ["Jesus", "Simon Peter", "James", "John"], "objects": ["boats", "nets", "fish", "lake"], "actions": ["teaching", "fishing", "sinking", "following"], "plot_points": ["Jesus teaches from Simon''s boat", "Jesus tells Simon to put out into deep water", "Simon obeys despite catching nothing all night", "Miraculous catch of fish", "Peter confesses his sinfulness", "Jesus calls them to catch men", "They leave everything and follow him"], "map_or_tree_reference": "Sea of Galilee", "error_paragraph_source": "And when they had finished speaking, he said to Simon, Put out into the shallow water and let down your nets for a catch. And Simon answered, Master, we toiled all night and took nothing! But at your word I will let down the nets.", "cross_reference_anchors": ["Matthew 4:18-22", "Mark 1:16-20", "John 1:35-42"], "milestone_verse": {"reference": "Luke 5:10", "text": "Do not be afraid; from now on you will be catching men."}}'::jsonb
),
(
  CURRENT_DATE - 1,
  'The Faith of the Centurion',
  'Faith that amazes Jesus.',
  'Luke 7:1-10',
  'After he had finished all his sayings in the hearing of the people, he entered Capernaum. Now a centurion had a servant who was sick and at the point of death, who was highly valued by him. When the centurion heard about Jesus, he sent to him elders of the Jews, asking him to come and heal his servant. And when they came to Jesus, they pleaded with him earnestly, saying, "He is worthy to have you do this for him, for he loves our nation, and he is the one who built us our synagogue." And Jesus went with them. When he was not far from the house, the centurion sent friends, saying to him, "Lord, do not trouble yourself, for I am not worthy to have you come under my roof. Therefore I did not presume to come to you. But say the word, and let my servant be healed. For I too am a man set under authority, with soldiers under me: and I say to one, ''Go,'' and he goes; and to another, ''Come,'' and he comes; and to my servant, ''Do this,'' and he does it." When Jesus heard these things, he marveled at him, and turning to the crowd that followed him, said, "I tell you, not even in Israel have I found such faith." And when those who had been sent returned to the house, they found the servant well.',
  '[{"reference":"Luke 7:9","text":"I tell you, not even in Israel have I found such faith.","meditation":"A Roman soldier, an outsider to the covenant, demonstrates a faith that amazes the Son of God. He understood authority because he lived under it."}]'::jsonb,
  '["What does it mean to have faith that amazes Jesus?","Where in your life do you need to simply say, ''Lord, just say the word''?","How does understanding earthly authority help us understand spiritual authority?"]'::jsonb,
  'The Authority Challenge',
  'Write down one situation where you need to trust Christ''s authority over it. Speak a prayer of surrender using the centurion''s words: "Lord, just say the word."',
  '{"key_verse": {"reference": "Luke 7:9", "text": "I tell you, not even in Israel have I found such faith."}, "characters": ["Jesus", "Centurion", "Servant", "Jewish Elders", "Friends"], "objects": ["house", "synagogue", "roof"], "actions": ["sending", "pleading", "healing", "marveling"], "plot_points": ["Centurion''s servant is near death", "Centurion sends Jewish elders to Jesus", "Elders plead that the centurion is worthy", "Jesus goes with them", "Centurion sends friends saying he is unworthy", "Centurion asks Jesus to just say the word", "Jesus marvels at his faith", "Servant is found well"], "map_or_tree_reference": "Capernaum", "error_paragraph_source": "And Jesus went with them. When he was not far from the house, the centurion sent friends, saying to him, Lord, trouble yourself, for I am worthy to have you come under my roof. Therefore I presumed to come to you.", "cross_reference_anchors": ["Matthew 8:5-13", "John 4:46-54"], "milestone_verse": {"reference": "Luke 7:9", "text": "I tell you, not even in Israel have I found such faith."}}'::jsonb
),
(
  CURRENT_DATE - 2,
  'The Good Samaritan',
  'Loving your neighbor crosses every boundary.',
  'Luke 10:25-37',
  'And behold, a lawyer stood up to put him to the test, saying, "Teacher, what shall I do to inherit eternal life?" He said to him, "What is written in the Law? How do you read it?" And he answered, "You shall love the Lord your God with all your heart and with all your soul and with all your strength and with all your mind, and your neighbor as yourself." And he said to him, "You have answered correctly; do this, and you will live." But he, desiring to justify himself, said to Jesus, "And who is my neighbor?" Jesus replied, "A man was going down from Jerusalem to Jericho, and he fell among robbers, who stripped him and beat him and departed, leaving him half dead. Now by chance a priest was going down that road. When he saw him he passed by on the other side. So likewise a Levite, when he came to the place and saw him, passed by on the other side. But a Samaritan, as he journeyed, came to where he was, and when he saw him, he had compassion. He went to him and bound up his wounds, pouring on oil and wine. Then he set him on his own animal and brought him to an inn and took care of him. And the next day he took out two denarii and gave them to the innkeeper, saying, ''Take care of him, and whatever more you spend, I will repay you when I come back.'' Which of these three, do you think, proved to be a neighbor to the man who fell among the robbers?" He said, "The one who showed him mercy." And Jesus said to him, "You go, and do likewise."',
  '[{"reference":"Luke 10:33-34","text":"But a Samaritan, as he journeyed, came to where he was, and when he saw him, he had compassion. He went to him and bound up his wounds, pouring on oil and wine.","meditation":"The unlikely neighbor is the one who crosses boundaries to show mercy. Love is not a feeling but an action that costs something."}]'::jsonb,
  '["Who is the ''neighbor'' you are tempted to walk past?","What boundaries does Jesus ask you to cross in showing mercy?","What does it cost you to show compassion to someone in need?"]'::jsonb,
  'The Mercy Challenge',
  'Identify one person you would normally walk past. Take one concrete action this week to show them mercy or meet a need.',
  '{"key_verse": {"reference": "Luke 10:36", "text": "Which of these three, do you think, proved to be a neighbor to the man who fell among the robbers?"}, "characters": ["Jesus", "Lawyer", "Man", "Robbers", "Priest", "Levite", "Samaritan", "Innkeeper"], "objects": ["road", "wounds", "oil", "wine", "animal", "inn", "denarii"], "actions": ["testing", "beating", "passing by", "compassion", "binding wounds", "paying", "caring"], "plot_points": ["Lawyer asks how to inherit eternal life", "Jesus points to the Law", "Lawyer asks who is my neighbor", "Man falls among robbers on Jericho road", "Priest passes by", "Levite passes by", "Samaritan has compassion", "Samaritan binds wounds and brings him to an inn", "Samaritan pays two denarii and promises more", "Jesus says go and do likewise"], "map_or_tree_reference": "Road from Jerusalem to Jericho", "error_paragraph_source": "Now by chance a priest was going up that road. When he saw him he passed by on the other side. So likewise a Levite, when he came to the place and saw him, stopped to help him.", "cross_reference_anchors": ["Matthew 22:34-40", "Mark 12:28-34"], "milestone_verse": {"reference": "Luke 10:33", "text": "But a Samaritan, as he journeyed, came to where he was, and when he saw him, he had compassion."}}'::jsonb
),
(
  CURRENT_DATE - 3,
  'The Prodigal Son',
  'The Father''s relentless grace.',
  'Luke 15:11-32',
  'And he said, "There was a man who had two sons. And the younger of them said to his father, ''Father, give me the share of property that is coming to me.'' And he divided his property between them. Not many days later, the younger son gathered all he had and took a journey into a far country, and there he squandered his property in reckless living. And when he had spent everything, a severe famine arose in that country, and he began to be in need. So he went and hired himself out to one of the citizens of that country, who sent him into his fields to feed pigs. And he was longing to be fed with the pods that the pigs ate, and no one gave him anything. But when he came to himself, he said, ''How many of my father''s hired servants have more than enough bread, but I perish here with hunger! I will arise and go to my father, and I will say to him, Father, I have sinned against heaven and before you. I am no longer worthy to be called your son. Treat me as one of your hired servants.'' And he arose and came to his father. But while he was still a long way off, his father saw him and felt compassion, and ran and embraced him and kissed him. And the son said to him, ''Father, I have sinned against heaven and before you. I am no longer worthy to be called your son.'' But the father said to his servants, ''Bring quickly the best robe, and put it on him, and put a ring on his hand, and shoes on his feet. And bring the fattened calf and kill it, and let us eat and celebrate. For this my son was dead, and is alive again; he was lost, and is found.'' And they began to celebrate. Now his older son was in the field, and as he came and drew near to the house, he heard music and dancing. And he called one of the servants and asked what these things meant. And he said to him, ''Your brother has come, and your father has killed the fattened calf, because he has received him back safe and sound.'' But he was angry and refused to go in. His father came out and entreated him, but he answered his father, ''Look, these many years I have served you, and I never disobeyed your command, yet you never gave me a young goat, that I might celebrate with my friends. But when this son of yours came, who has devoured your property with prostitutes, you killed the fattened calf for him!'' And he said to him, ''Son, you are always with me, and all that is mine is yours. It was fitting to celebrate and be glad, for this your brother was dead, and is alive; he was lost, and is found."''',
  '[{"reference":"Luke 15:20","text":"But while he was still a long way off, his father saw him and felt compassion, and ran and embraced him and kissed him.","meditation":"The father was watching. He ran. Grace does not wait for the wanderer to arrive — it runs to meet him while he is still a long way off."}]'::jsonb,
  '["Where have you wandered, and how is the Father calling you home?","What does the father''s running reveal about God''s heart?","Are you more like the younger son or the older son in this story?"]'::jsonb,
  'The Return Challenge',
  'Write a prayer of return to the Father. Name the ''far country'' you have been living in and ask for grace to come home.',
  '{"key_verse": {"reference": "Luke 15:20", "text": "But while he was still a long way off, his father saw him and felt compassion, and ran and embraced him and kissed him."}, "characters": ["Father", "Younger Son", "Older Son", "Servants"], "objects": ["property", "pigs", "pods", "robe", "ring", "shoes", "fattened calf", "music", "dancing"], "actions": ["squandering", "hiring", "feeding", "arising", "running", "embracing", "kissing", "celebrating", "refusing", "entreating"], "plot_points": ["Younger son demands his inheritance", "Father divides property", "Son leaves for a far country", "Son squanders everything in reckless living", "Famine strikes the land", "Son hires himself to feed pigs", "Son comes to himself", "Son decides to return to his father", "Father sees him from a distance and runs to him", "Father embraces and kisses him", "Father commands the best robe, ring, shoes, and feast", "Older son hears the celebration and is angry", "Father entreats the older son", "Father explains: your brother was dead and is alive"], "map_or_tree_reference": "Far country to Father''s house", "error_paragraph_source": "But when he came to himself, he said, How many of my father''s hired servants have more than enough bread, but I perish here with hunger! I will stay here and eat with the pigs.", "cross_reference_anchors": ["Luke 15:1-10", "Ephesians 2:1-9", "Romans 5:8"], "milestone_verse": {"reference": "Luke 15:24", "text": "For this my son was dead, and is alive again; he was lost, and is found."}}'::jsonb
),
(
  CURRENT_DATE - 4,
  'Walking on Water',
  'Faith that sinks and faith that stands.',
  'Matthew 14:22-33',
  'Immediately he made the disciples get into the boat and go before him to the other side, while he dismissed the crowds. And after he had dismissed the crowds, he went up on the mountain by himself to pray. When evening came, he was there alone, but the boat by this time was many furlongs from the land, beaten by the waves, for the wind was against them. And in the fourth watch of the night he came to them, walking on the sea. But when the disciples saw him walking on the sea, they were terrified, and said, "It is a ghost!" and they cried out in fear. But immediately Jesus spoke to them, saying, "Take heart; it is I. Do not be afraid." And Peter answered him, "Lord, if it is you, command me to come to you on the water." He said, "Come." So Peter got out of the boat and walked on the water and came to Jesus. But when he saw the wind, he was afraid, and beginning to sink he cried out, "Lord, save me." Jesus immediately reached out his hand and took hold of him, saying to him, "O you of little faith, why did you doubt?" And when they got into the boat, the wind ceased. And those in the boat worshiped him, saying, "Truly you are the Son of God."',
  '[{"reference":"Matthew 14:27","text":"Take heart; it is I. Do not be afraid.","meditation":"Jesus comes to us in the middle of our storms, walking on the very thing that threatens to drown us. His presence is the command to fear not."}]'::jsonb,
  '["What storm are you in right now? Where is Jesus inviting you to look?","When have you stepped out in faith only to sink? What did you cry out?","What does it mean that Jesus reached out his hand immediately?"]'::jsonb,
  'The Step of Faith Challenge',
  'Identify one ''boat'' of comfort or safety that Jesus is calling you out of. Write down the first step you will take this week.',
  '{"key_verse": {"reference": "Matthew 14:27", "text": "Take heart; it is I. Do not be afraid."}, "characters": ["Jesus", "Disciples", "Peter"], "objects": ["boat", "mountain", "waves", "wind", "water", "hand"], "actions": ["praying", "walking", "sinking", "crying out", "reaching", "worshiping"], "plot_points": ["Jesus makes disciples get into the boat", "Jesus goes up the mountain to pray", "Boat is beaten by waves far from land", "Jesus comes walking on the sea in the fourth watch", "Disciples think he is a ghost and cry out", "Jesus says: Take heart, it is I, do not be afraid", "Peter asks to come on the water", "Jesus says Come", "Peter walks on water toward Jesus", "Peter sees the wind and begins to sink", "Peter cries out: Lord save me", "Jesus reaches out and catches him", "Wind ceases when they enter the boat", "Disciples worship him as Son of God"], "map_or_tree_reference": "Sea of Galilee", "error_paragraph_source": "So Peter got out of the boat and walked on the water and came to Jesus. But when he saw the wind, he was confident, and continuing to walk he came to Jesus without sinking.", "cross_reference_anchors": ["Mark 6:45-52", "John 6:16-21"], "milestone_verse": {"reference": "Matthew 14:27", "text": "Take heart; it is I. Do not be afraid."}}'::jsonb
),
(
  CURRENT_DATE - 5,
  'The Sower and the Seed',
  'The condition of the soil determines the harvest.',
  'Mark 4:1-20',
  'Again he began to teach beside the sea. And a very large crowd gathered about him, so that he got into a boat and sat in it on the sea, and the whole crowd was beside the sea on the land. And he was teaching them many things in parables, and in his teaching he said to them: "Listen! Behold, a sower went out to sow. And as he sowed, some seed fell along the path, and the birds came and devoured it. Other seed fell on rocky ground, where it did not have much soil, and immediately it sprang up, since it had no depth of soil. And when the sun rose, it was scorched, and since it had no root, it withered away. Other seed fell among thorns, and the thorns grew up and choked it, and it yielded no grain. And other seeds fell into good soil and produced grain, growing up and increasing and yielding thirtyfold and sixtyfold and a hundredfold." And he said, "He who has ears to hear, let him hear." ... And he said to them, "Do you not understand this parable? How then will you understand all the parables? The sower sows the word. And these are the ones along the path, where the word is sown: when they hear, Satan immediately comes and takes away the word that is sown in them. And these are the ones sown on rocky ground: the ones who, when they hear the word, immediately receive it with joy. And they have no root in themselves, but endure for a while; then, when tribulation or persecution arises on account of the word, immediately they fall away. And others are the ones sown among thorns. They are those who hear the word, but the cares of the world and the deceitfulness of riches and the desires for other things enter in and choke the word, and it proves unfruitful. But those that were sown on the good soil are the ones who hear the word and accept it and bear fruit, thirtyfold and sixtyfold and a hundredfold."',
  '[{"reference":"Mark 4:20","text":"But those that were sown on the good soil are the ones who hear the word and accept it and bear fruit, thirtyfold and sixtyfold and a hundredfold.","meditation":"The same seed, four different soils. The difference is not in the word but in the heart that receives it. What is the condition of your soil today?"}]'::jsonb,
  '["Which soil best describes your heart right now?","What are the thorns choking the word in your life?","What would it look like to cultivate good soil this week?"]'::jsonb,
  'The Soil Challenge',
  'Write down one thorn (distraction, worry, or desire) that is choking God''s word in your life. Commit to one practice this week that cultivates good soil.',
  '{"key_verse": {"reference": "Mark 4:20", "text": "But those that were sown on the good soil are the ones who hear the word and accept it and bear fruit, thirtyfold and sixtyfold and a hundredfold."}, "characters": ["Jesus", "Crowd", "Sower"], "objects": ["seed", "path", "rocky ground", "thorns", "good soil", "birds", "sun", "grain"], "actions": ["sowing", "devouring", "springing up", "scorching", "withering", "choking", "bearing fruit"], "plot_points": ["Jesus teaches beside the sea from a boat", "Sower goes out to sow", "Seed falls on the path and birds eat it", "Seed falls on rocky ground and springs up then withers", "Seed falls among thorns and is choked", "Seed falls on good soil and yields 30, 60, 100 fold", "Jesus explains: the sower sows the word", "Path hearers: Satan takes the word", "Rocky hearers: no root, fall away under persecution", "Thorny hearers: cares of world choke the word", "Good soil hearers: hear, accept, and bear fruit"], "map_or_tree_reference": "Four soils diagram", "error_paragraph_source": "Other seed fell among thorns, and the thorns grew up and produced grain, yielding thirtyfold and sixtyfold and a hundredfold.", "cross_reference_anchors": ["Matthew 13:1-23", "Luke 8:4-15"], "milestone_verse": {"reference": "Mark 4:20", "text": "But those that were sown on the good soil are the ones who hear the word and accept it and bear fruit, thirtyfold and sixtyfold and a hundredfold."}}'::jsonb
),
(
  CURRENT_DATE - 6,
  'The Sermon on the Mount',
  'Blessings that turn the world upside down.',
  'Matthew 5:1-16',
  'Seeing the crowds, he went up on the mountain, and when he sat down, his disciples came to him. And he opened his mouth and taught them, saying: "Blessed are the poor in spirit, for theirs is the kingdom of heaven. Blessed are those who mourn, for they shall be comforted. Blessed are the meek, for they shall inherit the earth. Blessed are those who hunger and thirst for righteousness, for they shall be satisfied. Blessed are the merciful, for they shall receive mercy. Blessed are the pure in heart, for they shall see God. Blessed are the peacemakers, for they shall be called sons of God. Blessed are those who are persecuted for righteousness'' sake, for theirs is the kingdom of heaven. Blessed are you when others revile you and persecute you and utter all kinds of evil against you falsely on my account. Rejoice and be glad, for your reward is great in heaven, for so they persecuted the prophets who were before you. You are the salt of the earth, but if salt has lost its taste, how shall its saltiness be restored? ... You are the light of the world. A city set on a hill cannot be hidden. Nor do people light a lamp and put it under a basket, but on a stand, and it gives light to all in the house. In the same way, let your light shine before others, so that they may see your good works and give glory to your Father who is in heaven."',
  '[{"reference":"Matthew 5:6","text":"Blessed are those who hunger and thirst for righteousness, for they shall be satisfied.","meditation":"The hunger itself is the blessing. God fills those who ache for His righteousness, not those who are full of themselves."}]'::jsonb,
  '["Which beatitude speaks most to your current season?","What does it mean to be salt and light in your daily life?","Where are you tempted to hide your light under a basket?"]'::jsonb,
  'The Light Challenge',
  'Identify one specific way you will let your light shine this week — at home, school, or work. Write it down and act on it.',
  '{"key_verse": {"reference": "Matthew 5:6", "text": "Blessed are those who hunger and thirst for righteousness, for they shall be satisfied."}, "characters": ["Jesus", "Disciples", "Crowds"], "objects": ["mountain", "salt", "light", "lamp", "basket", "stand", "city", "hill"], "actions": ["teaching", "mourning", "hungering", "thirsting", "showing mercy", "making peace", "rejoicing", "shining"], "plot_points": ["Jesus goes up on the mountain", "Disciples come to him", "Jesus teaches the Beatitudes", "Poor in spirit: kingdom of heaven", "Mourning: comforted", "Meek: inherit the earth", "Hunger and thirst for righteousness: satisfied", "Merciful: receive mercy", "Pure in heart: see God", "Peacemakers: called sons of God", "Persecuted: kingdom of heaven", "You are the salt of the earth", "You are the light of the world", "Let your light shine before others"], "map_or_tree_reference": "Mountainside overlooking Galilee", "error_paragraph_source": "You are the salt of the earth, but if salt has lost its taste, how shall its saltiness be restored? It is good for nothing except to be thrown out and trampled underfoot. You are the light of the world. A city set on a hill can be hidden.", "cross_reference_anchors": ["Luke 6:20-26", "Isaiah 61:1-3"], "milestone_verse": {"reference": "Matthew 5:6", "text": "Blessed are those who hunger and thirst for righteousness, for they shall be satisfied."}}'::jsonb
)
ON CONFLICT (narrative_date) DO NOTHING;
