-- =============================================================================
-- Social Login Password Migration
-- =============================================================================
-- 목적: 소셜 로그인 사용자들의 패스워드를 NULL로 설정하고,
--       패스워드 해시 컬럼을 nullable로 변경
-- 
-- 변경 사항:
-- 1. password_hash 컬럼을 nullable로 변경
-- 2. 소셜 로그인 사용자(social_name이 있는 경우)의 password_hash를 NULL로 설정
-- =============================================================================

-- 1. password_hash 컬럼을 nullable로 변경
ALTER TABLE users
ALTER COLUMN password_hash DROP NOT NULL;

-- 2. 소셜 로그인 사용자들의 패스워드를 NULL로 설정
UPDATE users
SET password_hash = NULL
WHERE social_name IS NOT NULL;

-- 3. 검증: 변경된 내용 확인
-- 소셜 로그인 사용자 중 password_hash가 NULL인지 확인
SELECT 
  user_id,
  email,
  social_name,
  password_hash,
  created_at
FROM users
WHERE social_name IS NOT NULL
LIMIT 10;

-- 4. 일반 회원가입 사용자들의 password_hash가 여전히 NOT NULL인지 확인
SELECT 
  user_id,
  email,
  social_name,
  password_hash IS NOT NULL as has_password,
  created_at
FROM users
WHERE social_name IS NULL
LIMIT 10;
