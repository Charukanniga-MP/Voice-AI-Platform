import { Router, Request, Response } from 'express';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const router = Router();
const SHARED_BRANCH = 'main';

// Strict security middleware: Only allow in development mode
router.use((req: Request, res: Response, next) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ error: 'Git synchronization tools are strictly disabled in production.' });
    return;
  }
  next();
});

function runGit(cmd: string, cwd = process.cwd()): string {
  try {
    // Project root is one level up from server if cwd is server
    const rootDir = fs.existsSync(path.resolve(cwd, '../scripts')) ? path.resolve(cwd, '..') : cwd;
    return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], cwd: rootDir }).trim();
  } catch {
    return '';
  }
}

// 1. Get synchronization status
router.get('/status', (req: Request, res: Response) => {
  try {
    const currentBranch = runGit('branch --show-current') || 'unknown';
    const localSha = runGit('rev-parse --short HEAD') || 'unknown';
    const remoteSha = runGit(`rev-parse --short origin/${SHARED_BRANCH}`) || 'unknown';

    const ahead = parseInt(runGit(`rev-list --count origin/${SHARED_BRANCH}..HEAD`) || '0', 10);
    const behind = parseInt(runGit(`rev-list --count HEAD..origin/${SHARED_BRANCH}`) || '0', 10);

    const rawStatus = runGit('status --porcelain') || '';
    const dirtyFiles = rawStatus
      ? rawStatus.split('\n').filter(Boolean).map(line => ({
          status: line.slice(0, 2).trim(),
          file: line.slice(2).trim()
        }))
      : [];

    const conflictFiles = rawStatus
      ? rawStatus.split('\n').filter(line => line.startsWith('UU') || line.startsWith('AA') || line.startsWith('UD') || line.startsWith('DU')).map(l => l.slice(3).trim())
      : [];

    const rawCommits = runGit(`log HEAD..origin/${SHARED_BRANCH} --oneline -n 10`) || '';
    const incomingCommits = rawCommits ? rawCommits.split('\n').filter(Boolean) : [];

    const rawChangedFiles = runGit(`diff --name-status HEAD origin/${SHARED_BRANCH}`) || '';
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

// 2. Fetch updates from GitHub
router.post('/fetch', (req: Request, res: Response) => {
  try {
    runGit(`fetch origin ${SHARED_BRANCH}`);
    res.json({ success: true, message: `Fetched latest updates from origin/${SHARED_BRANCH}` });
  } catch (err: any) {
    res.status(500).json({ error: 'Fetch failed', details: err.message });
  }
});

// 3. Trigger safe pull & sync
router.post('/pull', (req: Request, res: Response) => {
  try {
    const rootDir = fs.existsSync(path.resolve(process.cwd(), '../scripts')) ? path.resolve(process.cwd(), '..') : process.cwd();
    const scriptPath = path.resolve(rootDir, 'scripts/sync-team.js');
    
    // Execute safePull programmatically
    const output = execSync(`node "${scriptPath}" pull`, { encoding: 'utf8', cwd: rootDir });
    res.json({ success: true, message: 'Synchronization completed', output });
  } catch (err: any) {
    res.status(500).json({ error: 'Pull operation failed or encountered conflicts', details: err.message, stdout: err.stdout?.toString() });
  }
});

// 4. Trigger safe push
router.post('/push', (req: Request, res: Response) => {
  try {
    const rootDir = fs.existsSync(path.resolve(process.cwd(), '../scripts')) ? path.resolve(process.cwd(), '..') : process.cwd();
    const scriptPath = path.resolve(rootDir, 'scripts/sync-team.js');

    const output = execSync(`node "${scriptPath}" push`, { encoding: 'utf8', cwd: rootDir });
    res.json({ success: true, message: 'Push completed successfully', output });
  } catch (err: any) {
    res.status(500).json({ error: 'Push operation failed', details: err.message, stdout: err.stdout?.toString() });
  }
});

export default router;

