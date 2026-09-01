@echo off
setlocal enabledelayedexpansion

set "DATABASE_URL=postgresql://postgres.iijmbfkqrhpxsmvbrmwu:Kindness37289774@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"
set "DIRECT_URL=postgresql://postgres.iijmbfkqrhpxsmvbrmwu:Kindness37289774@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"

echo Baseline-ing existing migrations (except the two still pending)...
echo.

for /d %%i in (prisma\migrations\*) do (
  set "name=%%~nxi"
  if /I not "!name!"=="20260819110000_add_bvn_license_onboarding" if /I not "!name!"=="20260828120000_add_cac_service_request" (
    echo   marking !name! as applied
    call npx prisma migrate resolve --applied "!name!"
  )
)

echo.
echo Now applying the two real pending migrations to production...
echo.
call npx prisma migrate deploy

echo.
echo Final status check:
echo.
call npx prisma migrate status

echo.
pause
