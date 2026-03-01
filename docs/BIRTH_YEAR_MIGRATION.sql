-- users.birth_date (date) -> users.birth_year (varchar(4)) migration
-- Run this once before deploying code that maps User.birthYear to birth_year.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS birth_year varchar(4);

UPDATE users
SET birth_year = EXTRACT(YEAR FROM birth_date)::text
WHERE birth_date IS NOT NULL
  AND (birth_year IS NULL OR birth_year = '');

UPDATE users
SET birth_year = '1970'
WHERE birth_year IS NULL OR birth_year = '';

ALTER TABLE users
  ALTER COLUMN birth_year SET DEFAULT '1970',
  ALTER COLUMN birth_year SET NOT NULL;

ALTER TABLE users
  DROP COLUMN IF EXISTS birth_date;

COMMIT;
