# KAIRA Technologies - Team Code Synchronization PowerShell Script
# Usage:
#   .\scripts\sync-team.ps1 status
#   .\scripts\sync-team.ps1 check
#   .\scripts\sync-team.ps1 pull
#   .\scripts\sync-team.ps1 push
#   .\scripts\sync-team.ps1 resolve

param (
    [string]$Action = "dashboard"
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   KAIRA Technologies - Team Code Synchronization (PowerShell)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Delegate to the Node sync-team.js engine for cross-platform unified logic
node scripts/sync-team.js $Action

