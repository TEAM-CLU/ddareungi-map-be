-- users.birth_date (date) -> users.birth_year (varchar(4)) migration
-- Run this once before deploying code that maps User.birthYear to birth_year.
--
-- NOTE:
-- - birth_year는 NULL 허용(기본값/NOT NULL 강제 없음) 정책을 권장합니다.
-- - birth_date에서 연도만 추출해 채우고, birth_date가 없던 row는 birth_year를 NULL로 유지합니다.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS birth_year varchar(4);

UPDATE users
SET birth_year = EXTRACT(YEAR FROM birth_date)::text
WHERE birth_date IS NOT NULL
  AND (birth_year IS NULL OR birth_year = '');

ALTER TABLE users
  DROP COLUMN IF EXISTS birth_date;

COMMIT;
