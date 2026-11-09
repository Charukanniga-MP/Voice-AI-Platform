#!/usr/bin/env node
/**
 * KAIRA Technologies - Team Code Synchronization Utility
 *
 * Provides safe, non-destructive synchronization with the shared GitHub repository:
 * https://github.com/Charukanniga-MP/Voice-AI-Platform.git
 *
 * Key guarantees:
 * - Never overwrites uncommitted local work (auto-stash & safety backups).
 * - Never force-pushes or silently deletes commits.
 * - Clear conflict detection with non-destructive options (keep-ours, take-theirs, preview).
 * - Automatic post-sync triggers (npm install, prisma generate, build verification).
 * - Dev-only usage: never run in production.
 */

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const EXPECTED_REMOTE_URL = 'https://github.com/Charukanniga-MP/Voice-AI-Platform.git';
const SHARED_BRANCH = 'main';
const BACKUP_DIR = path.resolve(process.cwd(), '.git-backups');

// ANSI color helpers
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgBlue: '\x1b[44m'
};

function runGit(cmd, opts = {}) {
  try {
    const res = execSync(`git ${cmd}`, {
      encoding: 'utf8',
      stdio: opts.silent ? 'pipe' : opts.pipe ? 'pipe' : 'inherit',
      cwd: process.cwd()
    });
    return (res || '').trim();
  } catch (err) {
    if (opts.allowFail) return null;
    throw err;
  }
}

function runGitSilent(cmd) {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], cwd: process.cwd() }).trim();
  } catch {
    return null;
  }
}

function promptUser(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

/**
 * Validates repository connection and remote
 */
export function verifyGitEnvironment() {
  const isGit = runGitSilent('rev-parse --is-inside-work-tree');
  if (isGit !== 'true') {
    console.error(`${c.red}Error: Current directory is not a Git repository.${c.reset}`);
    process.exit(1);
  }

  const remotes = runGitSilent('remote -v') || '';
  const hasOrigin = remotes.includes('origin');
  if (!hasOrigin) {
    console.error(`${c.red}Error: Remote 'origin' is not configured.${c.reset}`);
    process.exit(1);
  }

  const currentBranch = runGitSilent('branch --show-current') || 'unknown';
  return { currentBranch, remotes };
}

/**
 * Creates an immutable timestamped backup before any pull or merge
 */
export function createSafetyBackup(action = 'sync') {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupId = `backup_${action}_${timestamp}`;
  const backupPath = path.join(BACKUP_DIR, backupId);
  fs.mkdirSync(backupPath, { recursive: true });

  // 1. Create a safety git branch pointer
  const currentSha = runGitSilent('rev-parse HEAD');
  const branchName = `backup/${action}-${timestamp}`;
  runGitSilent(`branch "${branchName}" HEAD`);

  // 2. Save diff of uncommitted changes
  const unstagedDiff = runGitSilent('diff') || '';
  const stagedDiff = runGitSilent('diff --cached') || '';
  const statusPorcelain = runGitSilent('status --porcelain') || '';

  fs.writeFileSync(path.join(backupPath, 'status.txt'), statusPorcelain);
  if (unstagedDiff) fs.writeFileSync(path.join(backupPath, 'unstaged.patch'), unstagedDiff);
  if (stagedDiff) fs.writeFileSync(path.join(backupPath, 'staged.patch'), stagedDiff);
  fs.writeFileSync(
    path.join(backupPath, 'metadata.json'),
    JSON.stringify({ backupId, timestamp, currentSha, branchName, action }, null, 2)
  );

  return { backupId, branchName, backupPath };
}

/**
 * Gathers complete status of local vs remote repository
 */
export function getSyncStatus(fetchFirst = false) {
  if (fetchFirst) {
    process.stdout.write(`${c.cyan}Fetching latest updates from origin/${SHARED_BRANCH}...${c.reset}\n`);
    runGitSilent(`fetch origin ${SHARED_BRANCH}`);
  }

  const currentBranch = runGitSilent('branch --show-current') || 'unknown';
  const localSha = runGitSilent('rev-parse --short HEAD') || 'unknown';
  const remoteSha = runGitSilent(`rev-parse --short origin/${SHARED_BRANCH}`) || 'unknown';

  const ahead = parseInt(runGitSilent(`rev-list --count origin/${SHARED_BRANCH}..HEAD`) || '0', 10);
  const behind = parseInt(runGitSilent(`rev-list --count HEAD..origin/${SHARED_BRANCH}`) || '0', 10);

  const rawStatus = runGitSilent('status --porcelain') || '';
  const dirtyFiles = rawStatus
    ? rawStatus.split('\n').filter(Boolean).map(line => ({
        status: line.slice(0, 2).trim(),
        file: line.slice(2).trim()
      }))
    : [];

  // Check for merge conflicts
  const conflictLines = rawStatus
    ? rawStatus.split('\n').filter(line => line.startsWith('UU') || line.startsWith('AA') || line.startsWith('UD') || line.startsWith('DU'))
    : [];
  const conflictFiles = conflictLines.map(line => line.slice(3).trim());

  let state = 'in_sync';
  if (conflictFiles.length > 0) state = 'conflicts';
  else if (behind > 0 && ahead > 0) state = 'diverged';
  else if (behind > 0) state = 'behind';
  else if (ahead > 0) state = 'ahead';

  return {
    currentBranch,
    localSha,
    remoteSha,
    ahead,
    behind,
    dirtyFiles,
    conflictFiles,
    state,
    isClean: dirtyFiles.length === 0
  };
}

/**
 * Checks for incoming commits from teammates
 */
export function getIncomingCommits() {
  const rawCommits = runGitSilent(`log HEAD..origin/${SHARED_BRANCH} --oneline --no-merges`) || '';
  const commits = rawCommits ? rawCommits.split('\n').filter(Boolean) : [];

  const rawFiles = runGitSilent(`diff --name-status HEAD origin/${SHARED_BRANCH}`) || '';
  const changedFiles = rawFiles
    ? rawFiles.split('\n').filter(Boolean).map(line => {
        const parts = line.split('\t');
        return { status: parts[0], file: parts[1] };
      })
    : [];

  return { commits, changedFiles };
}

/**
 * Checks for local outgoing commits ready to push
 */
export function getOutgoingCommits() {
  const rawCommits = runGitSilent(`log origin/${SHARED_BRANCH}..HEAD --oneline`) || '';
  const commits = rawCommits ? rawCommits.split('\n').filter(Boolean) : [];
  return commits;
}

/**
 * Executes safe pull of teammate changes
 */
export async function safePull(interactive = true) {
  console.log(`\n${c.bold}${c.cyan}=== KAIRA Team Synchronization: Safe Pull ===${c.reset}\n`);

  verifyGitEnvironment();

  // 1. Fetch remote updates first
  process.stdout.write(`${c.dim}[1/5] Contacting GitHub and fetching origin/${SHARED_BRANCH}...${c.reset}\n`);
  try {
    execSync(`git fetch origin ${SHARED_BRANCH}`, { stdio: 'inherit' });
  } catch (err) {
    console.error(`${c.red}Failed to fetch from GitHub: ${err.message}${c.reset}`);
    return { success: false, error: 'Network/remote fetch failure' };
  }

  const status = getSyncStatus(false);
  const { commits: incomingCommits, changedFiles } = getIncomingCommits();

  // 2. Check if already up-to-date
  if (status.behind === 0) {
    console.log(`${c.green}✓ Already up to date! No new commits on origin/${SHARED_BRANCH}.${c.reset}`);
    if (status.ahead > 0) {
      console.log(`${c.yellow}You have ${status.ahead} local commit(s) ready to push. Run 'npm run sync:push' when ready.${c.reset}`);
    }
    return { success: true, updated: false };
  }

  console.log(`${c.yellow}Found ${status.behind} incoming commit(s) from teammates:${c.reset}`);
  incomingCommits.slice(0, 10).forEach(cm => console.log(`  ${c.dim}•${c.reset} ${cm}`));
  if (incomingCommits.length > 10) console.log(`  ${c.dim}... and ${incomingCommits.length - 10} more${c.reset}`);

  console.log(`\n${c.yellow}Files modified by teammates (${changedFiles.length}):${c.reset}`);
  changedFiles.slice(0, 15).forEach(f => console.log(`  [${f.status}] ${f.file}`));
  if (changedFiles.length > 15) console.log(`  ... and ${changedFiles.length - 15} more`);

  // 3. Create Safety Backup
  console.log(`\n${c.dim}[2/5] Creating local safety backup...${c.reset}`);
  const backup = createSafetyBackup('pull');
  console.log(`${c.green}✓ Safety backup created: ${backup.backupId}${c.reset}`);
  console.log(`${c.dim}  Recovery branch: ${backup.branchName}${c.reset}`);

  // 4. Handle uncommitted local work safely
  let didStash = false;
  if (!status.isClean) {
    console.log(`\n${c.yellow}[3/5] Detected ${status.dirtyFiles.length} uncommitted local change(s).${c.reset}`);
    console.log(`${c.dim}To protect your work, changes will be stashed safely and restored after pull.${c.reset}`);

    const stashMsg = `autostash_before_team_sync_${Date.now()}`;
    const stashRes = runGitSilent(`stash push -u -m "${stashMsg}"`);
    if (stashRes && !stashRes.includes('No local changes to save')) {
      didStash = true;
      console.log(`${c.green}✓ Uncommitted work safely stashed.${c.reset}`);
    }
  } else {
    console.log(`${c.dim}[3/5] Working tree is clean. Proceeding to integrate changes...${c.reset}`);
  }

  // 5. Integrate remote commits
  console.log(`\n${c.dim}[4/5] Integrating teammate changes into local '${status.currentBranch}'...${c.reset}`);
  let pullSuccess = false;
  let hasConflicts = false;

  try {
    // Attempt rebase pull to keep clean linear commit history
    execSync(`git pull --rebase origin ${SHARED_BRANCH}`, { stdio: 'inherit' });
    pullSuccess = true;
  } catch (err) {
    // Check if stopped on conflict
    const postStatus = getSyncStatus(false);
    if (postStatus.conflictFiles.length > 0) {
      hasConflicts = true;
      console.error(`\n${c.bgRed}${c.white} CONFLICT DETECTED ${c.reset} Rebase encountered merge conflicts:`);
      postStatus.conflictFiles.forEach(f => console.log(`  ${c.red}✖ ${f}${c.reset}`));
      console.log(`\n${c.cyan}Your work is 100% safe in backup: ${backup.branchName}${c.reset}`);
      console.log(`${c.yellow}Run 'npm run sync:resolve' to step through and resolve conflicts safely.${c.reset}`);
      return { success: false, conflicts: postStatus.conflictFiles, backup };
    } else {
      console.error(`${c.red}Pull failed: ${err.message}${c.reset}`);
      return { success: false, error: err.message };
    }
  }

  // 6. Restore stashed changes if any
  if (didStash) {
    console.log(`\n${c.dim}Restoring your uncommitted local work...${c.reset}`);
    try {
      execSync('git stash pop', { stdio: 'inherit' });
      console.log(`${c.green}✓ Local changes successfully restored!${c.reset}`);
    } catch (stashErr) {
      console.warn(`${c.yellow}Note: Stashed changes restored with potential conflicts. Check 'git status'.${c.reset}`);
    }
  }

  // 7. Automated Post-Sync Triggers
  console.log(`\n${c.dim}[5/5] Running automated post-sync triggers...${c.reset}`);
  await runPostSyncTriggers(changedFiles.map(f => f.file));

  console.log(`\n${c.bold}${c.green}✓ SUCCESS: Team code synchronization complete!${c.reset}\n`);
  return { success: true, updated: true, updatedFiles: changedFiles };
}

/**
 * Automated post-sync actions based on files modified
 */
export async function runPostSyncTriggers(updatedFiles = []) {
  const hasPackageJson = updatedFiles.some(f => f.endsWith('package.json') || f.endsWith('package-lock.json'));
  const hasPrismaSchema = updatedFiles.some(f => f.includes('schema.prisma'));
  const hasServerFiles = updatedFiles.some(f => f.startsWith('server/'));
  const hasClientFiles = updatedFiles.some(f => f.startsWith('client/'));

  // 1. Dependency update
  if (hasPackageJson) {
    console.log(`\n${c.cyan}📦 Detected package.json changes. Updating dependencies...${c.reset}`);
    try {
      if (updatedFiles.some(f => f.startsWith('server/package.json'))) {
        console.log(`${c.dim}Running npm install in server/...${c.reset}`);
        execSync('npm install --prefix server', { stdio: 'inherit' });
      }
      if (updatedFiles.some(f => f.startsWith('client/package.json'))) {
        console.log(`${c.dim}Running npm install in client/...${c.reset}`);
        execSync('npm install --prefix client', { stdio: 'inherit' });
      }
      console.log(`${c.green}✓ Dependencies up to date.${c.reset}`);
    } catch (err) {
      console.warn(`${c.yellow}Warning: npm install encountered an issue: ${err.message}${c.reset}`);
    }
  }

  // 2. Database schema update
  if (hasPrismaSchema) {
    console.log(`\n${c.cyan}🗄️ Detected Prisma schema changes. Regenerating Prisma client...${c.reset}`);
    try {
      execSync('npm run prisma:generate --prefix server', { stdio: 'inherit' });
      console.log(`${c.green}✓ Prisma client regenerated successfully.${c.reset}`);

      console.log(`${c.cyan}Pushing database migrations...${c.reset}`);
      execSync('npm run prisma:push --prefix server', { stdio: 'inherit' });
      console.log(`${c.green}✓ Database schema pushed successfully.${c.reset}`);
    } catch (err) {
      console.warn(`${c.yellow}Warning: Prisma synchronization encountered an issue: ${err.message}${c.reset}`);
    }
  }

  // 3. Build & verification check
  if (hasClientFiles || hasServerFiles) {
    console.log(`\n${c.cyan}🔍 Verifying build integrity...${c.reset}`);
    try {
      if (hasClientFiles) {
        console.log(`${c.dim}Typechecking and building frontend...${c.reset}`);
        execSync('npm run build:client', { stdio: 'pipe' });
        console.log(`${c.green}✓ Frontend build verified.${c.reset}`);
      }
    } catch (err) {
      console.warn(`${c.yellow}Warning: Client build check reported errors. Please review.${c.reset}`);
    }
  }
}

/**
 * Executes safe push of local work to GitHub
 */
export async function safePush() {
  console.log(`\n${c.bold}${c.cyan}=== KAIRA Team Synchronization: Safe Push ===${c.reset}\n`);

  verifyGitEnvironment();

  // 1. Fetch remote status first
  process.stdout.write(`${c.dim}Checking remote status on origin/${SHARED_BRANCH}...${c.reset}\n`);
  runGitSilent(`fetch origin ${SHARED_BRANCH}`);

  const status = getSyncStatus(false);

  // 2. Pre-push validations
  if (status.behind > 0) {
    console.error(`\n${c.red}✖ PUSH BLOCKED: Your branch is behind origin/${SHARED_BRANCH} by ${status.behind} commit(s).${c.reset}`);
    console.log(`${c.yellow}You must pull and integrate teammate changes first:${c.reset}`);
    console.log(`  ${c.bold}npm run sync:pull${c.reset}\n`);
    return { success: false, error: 'Branch is behind remote' };
  }

  if (status.ahead === 0) {
    console.log(`${c.green}✓ Everything is up to date. No new local commits to push.${c.reset}`);
    return { success: true, pushed: false };
  }

  if (!status.isClean) {
    console.warn(`\n${c.yellow}Note: You have ${status.dirtyFiles.length} uncommitted file(s). Only committed changes will be pushed.${c.reset}`);
  }

  const outgoing = getOutgoingCommits();
  console.log(`\n${c.cyan}Commits ready to push to origin/${SHARED_BRANCH} (${outgoing.length}):${c.reset}`);
  outgoing.forEach(cm => console.log(`  ${c.dim}•${c.reset} ${cm}`));

  // 3. Run build verification before pushing to prevent breaking shared repo
  console.log(`\n${c.dim}Verifying build integrity before pushing...${c.reset}`);
  try {
    execSync('npm run build:client', { stdio: 'inherit' });
    console.log(`${c.green}✓ Frontend build verified cleanly.${c.reset}`);
  } catch (err) {
    console.error(`\n${c.red}✖ Push cancelled: Frontend build failed. Fix compilation errors before pushing to the team.${c.reset}`);
    return { success: false, error: 'Build check failed' };
  }

  // 4. Push safely (never with force)
  console.log(`\n${c.dim}Pushing ${status.ahead} commit(s) to origin/${SHARED_BRANCH}...${c.reset}`);
  try {
    execSync(`git push origin ${SHARED_BRANCH}`, { stdio: 'inherit' });
    console.log(`\n${c.bold}${c.green}✓ SUCCESS: All local commits successfully pushed to shared repository!${c.reset}\n`);
    return { success: true, pushed: true };
  } catch (err) {
    console.error(`${c.red}✖ Push failed: ${err.message}${c.reset}`);
    return { success: false, error: err.message };
  }
}

/**
 * Interactive conflict resolution wizard
 */
export async function resolveConflictsInteractive() {
  console.log(`\n${c.bold}${c.yellow}=== KAIRA Conflict Resolution Assistant ===${c.reset}\n`);

  const status = getSyncStatus(false);
  if (status.conflictFiles.length === 0) {
    console.log(`${c.green}✓ No unresolved conflicts detected! Working tree is ready.${c.reset}`);
    return;
  }

  console.log(`${c.yellow}The following files have conflicting edits between your work and teammate's work:${c.reset}`);
  status.conflictFiles.forEach((file, idx) => {
    console.log(`  ${c.bold}[${idx + 1}]${c.reset} ${c.red}${file}${c.reset}`);
  });

  console.log(`\n${c.dim}Options for resolution:${c.reset}`);
  console.log(`  ${c.bold}1${c.reset} - Keep My Version (Ours) for all files`);
  console.log(`  ${c.bold}2${c.reset} - Accept Teammate's Version (Theirs) for all files`);
  console.log(`  ${c.bold}3${c.reset} - Step through each file individually`);
  console.log(`  ${c.bold}4${c.reset} - Abort merge/rebase and restore previous state`);

  const choice = await promptUser(`\nSelect an option [1-4]: `);

  if (choice === '1') {
    for (const file of status.conflictFiles) {
      console.log(`Keeping local version for: ${file}`);
      runGitSilent(`checkout --ours "${file}"`);
      runGitSilent(`add "${file}"`);
    }
    console.log(`${c.green}✓ All files resolved to local version.${c.reset}`);
    completeConflictResolution();
  } else if (choice === '2') {
    for (const file of status.conflictFiles) {
      console.log(`Accepting teammate's incoming version for: ${file}`);
      runGitSilent(`checkout --theirs "${file}"`);
      runGitSilent(`add "${file}"`);
    }
    console.log(`${c.green}✓ All files resolved to teammate's version.${c.reset}`);
    completeConflictResolution();
  } else if (choice === '3') {
    for (const file of status.conflictFiles) {
      console.log(`\n${c.bold}Resolving: ${c.cyan}${file}${c.reset}`);
      const fileChoice = await promptUser(`  [1] Keep Mine (Ours)  |  [2] Accept Teammate's (Theirs)  |  [3] Skip/Manual: `);
      if (fileChoice === '1') {
        runGitSilent(`checkout --ours "${file}"`);
        runGitSilent(`add "${file}"`);
        console.log(`  ${c.green}✓ Kept local version.${c.reset}`);
      } else if (fileChoice === '2') {
        runGitSilent(`checkout --theirs "${file}"`);
        runGitSilent(`add "${file}"`);
        console.log(`  ${c.green}✓ Accepted teammate's version.${c.reset}`);
      } else {
        console.log(`  ${c.yellow}Skipped. Please edit ${file} manually and run 'git add ${file}'.${c.reset}`);
      }
    }
    const remaining = getSyncStatus(false).conflictFiles;
    if (remaining.length === 0) {
      completeConflictResolution();
    } else {
      console.log(`\n${c.yellow}${remaining.length} file(s) still require manual resolution.${c.reset}`);
    }
  } else if (choice === '4') {
    console.log(`${c.yellow}Aborting rebase/merge...${c.reset}`);
    runGitSilent('rebase --abort');
    runGitSilent('merge --abort');
    console.log(`${c.green}✓ Aborted. Working tree returned to previous state.${c.reset}`);
  }
}

function completeConflictResolution() {
  try {
    const isRebase = fs.existsSync(path.join(process.cwd(), '.git', 'rebase-merge')) || fs.existsSync(path.join(process.cwd(), '.git', 'rebase-apply'));
    if (isRebase) {
      execSync('git rebase --continue', { stdio: 'inherit' });
    } else {
      execSync('git commit -m "chore: resolve team merge conflicts safely"', { stdio: 'inherit' });
    }
    console.log(`${c.green}✓ Conflict resolution complete!${c.reset}`);
  } catch (err) {
    console.warn(`${c.yellow}Please verify remaining conflicts with 'git status'.${c.reset}`);
  }
}

/**
 * Prints comprehensive formatted status dashboard
 */
export function printDashboard() {
  verifyGitEnvironment();
  const status = getSyncStatus(false);
  const { commits: incoming, changedFiles } = getIncomingCommits();
  const outgoing = getOutgoingCommits();

  const termWidth = 65;
  const line = '─'.repeat(termWidth);

  console.log(`\n${c.bold}${c.cyan}┌${line}┐${c.reset}`);
  console.log(`${c.bold}${c.cyan}│             KAIRA VOICE AI - TEAM CODE SYNCHRONIZATION            │${c.reset}`);
  console.log(`${c.bold}${c.cyan}├${line}┤${c.reset}`);
  console.log(`│ Local Branch:      ${c.bold}${status.currentBranch.padEnd(46)}${c.reset}│`);
  console.log(`│ Tracking Remote:   ${c.dim}(origin/${SHARED_BRANCH})${c.reset}`.padEnd(termWidth + 8) + `│`);
  console.log(`│ Local Commit:      ${status.localSha}  |  Remote Commit: ${status.remoteSha}`.padEnd(termWidth + 1) + `│`);
  console.log(`│ Commits Ahead:     ${status.ahead > 0 ? c.green + status.ahead : c.dim + '0'}${c.reset} (ready to push)`.padEnd(termWidth + 10) + `│`);
  console.log(`│ Commits Behind:    ${status.behind > 0 ? c.yellow + status.behind : c.dim + '0'}${c.reset} (updates available)`.padEnd(termWidth + 10) + `│`);

  let statusLabel = `${c.green}✓ UP TO DATE${c.reset}`;
  if (status.state === 'conflicts') statusLabel = `${c.bgRed}${c.white} CONFLICTS DETECTED ${c.reset}`;
  else if (status.state === 'diverged') statusLabel = `${c.yellow}⚡ DIVERGED (Both local & remote commits)${c.reset}`;
  else if (status.state === 'behind') statusLabel = `${c.cyan}⬇ UPDATES AVAILABLE (${status.behind} commits)${c.reset}`;
  else if (status.state === 'ahead') statusLabel = `${c.green}⬆ READY TO PUSH (${status.ahead} commits)${c.reset}`;

  console.log(`│ Status:            ${statusLabel}`.padEnd(termWidth + 18) + `│`);
  console.log(`${c.bold}${c.cyan}├${line}┤${c.reset}`);

  if (status.dirtyFiles.length > 0) {
    console.log(`│ ${c.yellow}Uncommitted Local Changes (${status.dirtyFiles.length}):${c.reset}`.padEnd(termWidth + 10) + `│`);
    status.dirtyFiles.slice(0, 6).forEach(f => {
      const entry = `  [${f.status}] ${f.file}`;
      console.log(`│ ${entry.slice(0, termWidth - 4).padEnd(termWidth - 2)}│`);
    });
    if (status.dirtyFiles.length > 6) {
      console.log(`│   ... and ${status.dirtyFiles.length - 6} more files`.padEnd(termWidth) + `│`);
    }
    console.log(`${c.bold}${c.cyan}├${line}┤${c.reset}`);
  }

  if (incoming.length > 0) {
    console.log(`│ ${c.cyan}Incoming Teammate Commits (${incoming.length}):${c.reset}`.padEnd(termWidth + 10) + `│`);
    incoming.slice(0, 4).forEach(cm => {
      console.log(`│   • ${cm.slice(0, termWidth - 8).padEnd(termWidth - 6)}│`);
    });
    console.log(`${c.bold}${c.cyan}├${line}┤${c.reset}`);
  }

  console.log(`│ ${c.bold}Available Team Sync Commands:${c.reset}`.padEnd(termWidth + 10) + `│`);
  console.log(`│   ${c.bold}npm run sync:check${c.reset}    Check remote for teammate updates       │`);
  console.log(`│   ${c.bold}npm run sync:pull${c.reset}     Safely pull updates with auto-backup    │`);
  console.log(`│   ${c.bold}npm run sync:push${c.reset}     Verify and push your local commits      │`);
  console.log(`│   ${c.bold}npm run sync:resolve${c.reset}  Resolve merge conflicts safely          │`);
  console.log(`${c.bold}${c.cyan}└${line}┘${c.reset}\n`);
}

// CLI Command Router
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'dashboard';

  switch (command) {
    case 'status':
    case 'dashboard':
      printDashboard();
      break;

    case 'check':
    case 'fetch':
      getSyncStatus(true);
      printDashboard();
      break;

    case 'pull':
      await safePull(true);
      break;

    case 'push':
      await safePush();
      break;

    case 'resolve':
      await resolveConflictsInteractive();
      break;

    case 'backup':
      const b = createSafetyBackup('manual');
      console.log(`${c.green}✓ Manual safety backup created: ${b.backupId}${c.reset}`);
      break;

    default:
      console.log(`Usage: node scripts/sync-team.js [status|check|pull|push|resolve|backup]`);
      break;
  }
}

// Execute when invoked directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/sync-team.js')) {
  main().catch((err) => {
    console.error(`\n${c.red}Fatal sync error: ${err.message}${c.reset}`);
    process.exit(1);
  });
}
