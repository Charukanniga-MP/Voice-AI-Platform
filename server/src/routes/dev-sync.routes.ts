import { Router, Request, Response } from 'express';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();
const SHARED_BRANCH = 'main';

// 1. Strict Security Guard: Strictly disabled in production
router.use((req: Request, res: Response, next) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ error: 'Git synchronization tools are strictly disabled in production environments.' });
    return;
  }
  next();
});

// 2. Strict Access Control: Require valid JWT token with 'admin' role
router.use(authenticate);
router.use(requireRole(['admin']));

/**
 * Determines project root directory safely.
 */
function getProjectRootDir(): string {
  const cwd = process.cwd();
  const rootCandidate = path.resolve(cwd, '..');
  if (fs.existsSync(path.resolve(rootCandidate, 'scripts/sync-team.js'))) {
    return rootCandidate;
  }
  return cwd;
}

/**
 * Executes a hardcoded, whitelisted Git command array safely without invoking a system shell.
 * Uses execFileSync to completely eliminate shell injection vulnerabilities.
 */
function runSafeGit(args: string[]): string {
  const rootDir = getProjectRootDir();
  try {
    return execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000 // 15-second execution limit
    }).trim();
  } catch (err: any) {
    return '';
  }
}

// 1. Get synchronization status (Admin only)
router.get('/status', (req: Request, res: Response) => {
  try {
    const currentBranch = runSafeGit(['branch', '--show-current']) || 'unknown';
    const localSha = runSafeGit(['rev-parse', '--short', 'HEAD']) || 'unknown';
    const remoteSha = runSafeGit(['rev-parse', '--short', `origin/${SHARED_BRANCH}`]) || 'unknown';

    const aheadStr = runSafeGit(['rev-list', '--count', `origin/${SHARED_BRANCH}..HEAD`]);
    const behindStr = runSafeGit(['rev-list', '--count', `HEAD..origin/${SHARED_BRANCH}`]);
    const ahead = parseInt(aheadStr || '0', 10);
    const behind = parseInt(behindStr || '0', 10);

    const rawStatus = runSafeGit(['status', '--porcelain']) || '';
    const dirtyFiles = rawStatus
      ? rawStatus.split('\n').filter(Boolean).map(line => ({
          status: line.slice(0, 2).trim(),
          file: line.slice(2).trim()
        }))
      : [];

    const conflictFiles = rawStatus
      ? rawStatus
          .split('\n')
          .filter(line => line.startsWith('UU') || line.startsWith('AA') || line.startsWith('UD') || line.startsWith('DU'))
          .map(l => l.slice(3).trim())
      : [];

    const rawCommits = runSafeGit(['log', `HEAD..origin/${SHARED_BRANCH}`, '--oneline', '-n', '10']) || '';
    const incomingCommits = rawCommits ? rawCommits.split('\n').filter(Boolean) : [];

    const rawChangedFiles = runSafeGit(['diff', '--name-status', 'HEAD', `origin/${SHARED_BRANCH}`]) || '';
    const incomingFiles = rawChangedFiles
      ? rawChangedFiles.split('\n').filter(Boolean).map(line => {
          const parts = line.split('\t');
          return { status: parts[0], file: parts[1] };
        })
      : [];

    res.json({
      success: true,
      currentBranch,
      localSha,
      remoteSha,
      ahead,
      behind,
      dirtyFiles,
      conflictFiles,
      incomingCommits,
      incomingFiles,
      isClean: dirtyFiles.length === 0,
      state: conflictFiles.length > 0 ? 'conflicts' : (behind > 0 && ahead > 0 ? 'diverged' : (behind > 0 ? 'behind' : (ahead > 0 ? 'ahead' : 'in_sync')))
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve git status', details: err.message });
  }
});

// 2. Fetch updates from GitHub (Admin only)
router.post('/fetch', (req: Request, res: Response) => {
  try {
    runSafeGit(['fetch', 'origin', SHARED_BRANCH]);
    res.json({ success: true, message: `Fetched latest updates from origin/${SHARED_BRANCH}` });
  } catch (err: any) {
    res.status(500).json({ error: 'Fetch failed', details: err.message });
  }
});

// 3. Trigger safe pull & sync (Admin only)
router.post('/pull', (req: Request, res: Response) => {
  try {
    const rootDir = getProjectRootDir();
    const scriptPath = path.resolve(rootDir, 'scripts/sync-team.js');

    if (!fs.existsSync(scriptPath)) {
      res.status(404).json({ error: 'Sync script not found.' });
      return;
    }

    // Execute via Node binary directly with safe argument vector
    const output = execFileSync(process.execPath, [scriptPath, 'pull'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000
    });

    res.json({ success: true, message: 'Synchronization completed', output });
  } catch (err: any) {
    res.status(500).json({
      error: 'Pull operation failed or encountered conflicts',
      details: err.message,
      stdout: err.stdout?.toString()
    });
  }
});

// 4. Trigger safe push (Admin only)
router.post('/push', (req: Request, res: Response) => {
  try {
    const rootDir = getProjectRootDir();
    const scriptPath = path.resolve(rootDir, 'scripts/sync-team.js');

    if (!fs.existsSync(scriptPath)) {
      res.status(404).json({ error: 'Sync script not found.' });
      return;
    }

    // Execute via Node binary directly with safe argument vector
    const output = execFileSync(process.execPath, [scriptPath, 'push'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000
    });

    res.json({ success: true, message: 'Push completed successfully', output });
  } catch (err: any) {
    res.status(500).json({
      error: 'Push operation failed',
      details: err.message,
      stdout: err.stdout?.toString()
    });
  }
});

export default router;
