@echo off
REM Starts a local web server for the piano app and opens it in your browser.
REM Needed so the "Piano samples" engine can load the local sample files
REM (browsers block file:// pages from reading them).

cd /d "%~dp0"
echo Starting Web Piano at http://localhost:8000  (close this window to stop)
start "" http://localhost:8000
python -m http.server 8000 --bind 127.0.0.1
