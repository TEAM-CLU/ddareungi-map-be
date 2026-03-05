-- users 테이블에서 birth_year만 유지하고 birth_day를 제거하는 마이그레이션
-- Supabase(PostgreSQL) SQL Editor에서 실행 가능

BEGIN;

-- 1) birth_year 컬럼이 없을 수 있는 환경 대비
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS birth_year varchar(4);

-- 2) birth_year 데이터 정규화 (YYYY 형식이 아니면 NULL 처리)
UPDATE users
SET birth_year = NULL
WHERE birth_year IS NOT NULL
  AND birth_year !~ '^\d{4}$';

-- 3) 더 이상 사용하지 않는 birth_day 컬럼 제거
ALTER TABLE users
  DROP COLUMN IF EXISTS birth_day;

COMMIT;
