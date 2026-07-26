-- Add passage column to custom_questions for comprehension/fill_blank questions
ALTER TABLE public.custom_questions 
ADD COLUMN IF NOT EXISTS passage text;
