@echo off
REM ─────────────────────────────────────────────────────────────────────────────
REM  tools/verify-win.cmd — the Windows verification harness for offline mode.
REM
REM  Nothing is "done" without a run of this file. Every assertion below exists
REM  because a specific defect was found by exactly this kind of check:
REM
REM    --agents            every statute cited by every doctrine map exists in the bundle
REM    test_agent_wills_*   the reference agent's 40 assertions (the regression gate)
REM    test_agent_torts    the second agent's 26, proving the runner generalises
REM    syntax gates        node --check on every offline module
REM
REM  Exit code is non-zero if any gate fails, so CI can block on it.
REM ─────────────────────────────────────────────────────────────────────────────
setlocal enabledelayedexpansion
cd /d "%~dp0.."
set FAILED=0

echo ============================================================
echo  Offline multi-agent verification
echo ============================================================
echo.

echo [1/4] every cited statute exists in the bundle
node "tools\check-citations.js" --agents
if errorlevel 1 ( echo   ** FAILED ** & set FAILED=1 )
echo.

echo [2/5] syntax of every offline module
for %%F in (agent-runner.js arbitrator.js router.js index.js corpus.js statute-verifier.js) do (
  node --check "jsons\offline\%%F"
  if errorlevel 1 ( echo   ** %%F FAILED ** & set FAILED=1 )
)
echo   ok   all offline modules parse
echo.

echo [3/4] Wills ^& Trusts agent (reference, 40 assertions)
node "tools\test_agent_wills_a.js"
if errorlevel 1 ( set FAILED=1 )
node "tools\test_agent_wills_b.js"
if errorlevel 1 ( set FAILED=1 )
echo.

echo [4/5] Torts agent (26 assertions)
node "tools\test_agent_torts.js"
if errorlevel 1 ( set FAILED=1 )
echo.

echo [5/5] corpus verification against the live source (cache-first; never on a normal ask)
node "tools\test_corpus_verify.js"
if errorlevel 1 ( set FAILED=1 )
echo.

echo ============================================================
if "%FAILED%"=="1" (
  echo  RESULT: FAILED -- do not ship
  exit /b 1
)
echo  RESULT: all gates passed
exit /b 0
