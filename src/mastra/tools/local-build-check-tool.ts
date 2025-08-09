import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const resolveToken = (inputToken?: string): string | undefined => {
  return (
    inputToken ||
    process.env.GITHUB_TOKEN ||
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN ||
    undefined
  );
};

const buildHeaders = (token?: string, requireAuth: boolean = false): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (requireAuth) {
    throw new Error('Missing GitHub token');
  }
  return headers;
};

const throwIfNotOk = async (res: any) => {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${body}`);
  }
};

function run(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
  const child = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return {
    status: child.status ?? -1,
    stdout: child.stdout?.toString() ?? '',
    stderr: child.stderr?.toString() ?? '',
  };
}

function detectPackageManager(repoDir: string): 'pnpm' | 'yarn' | 'bun' | 'npm' {
  if (existsSync(join(repoDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(repoDir, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(repoDir, 'bun.lockb'))) return 'bun';
  return 'npm';
}

export const localBuildCheckTool = createTool({
  id: 'local-build-check',
  description: 'Download a repo at a ref, install dependencies, and run build to verify compilation',
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    ref: z.string().optional(),
    subdir: z.string().optional(),
    token: z.string().optional(),
    timeoutMs: z.number().min(1000).max(60 * 60 * 1000).default(10 * 60 * 1000).optional(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    buildCommand: z.string().optional(),
    packageManager: z.string().optional(),
    logs: z.string(),
    workspacePath: z.string(),
  }),
  execute: async ({ context }) => {
    const owner = context.owner;
    const repo = context.repo;
    const ref = context.ref || 'HEAD';
    const token = resolveToken(context.token);
    const timeoutMs = context.timeoutMs ?? 10 * 60 * 1000;

    // Create temp directory
    const baseTmp = mkdtempSync(join(tmpdir(), 'build-check-'));
    const tarPath = join(baseTmp, 'repo.tar.gz');
    const extractDir = join(baseTmp, 'repo');

    // Fetch tarball
    const tarUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tarball/${encodeURIComponent(ref)}`;
    const res = await fetch(tarUrl, { headers: buildHeaders(token, !!token) });
    await throwIfNotOk(res);
    const arrayBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    writeFileSync(tarPath, buf);

    // Extract (requires 'tar')
    const mkDirRes = run('mkdir', ['-p', extractDir], baseTmp);
    if (mkDirRes.status !== 0) {
      return { ok: false, logs: mkDirRes.stderr || mkDirRes.stdout, workspacePath: baseTmp };
    }
    const tarRes = run('tar', ['-xzf', tarPath, '-C', extractDir], baseTmp);
    if (tarRes.status !== 0) {
      return { ok: false, logs: tarRes.stderr || tarRes.stdout, workspacePath: baseTmp };
    }

    // Find extracted repo root (tarball contains top-level directory)
    const listing = run('ls', ['-1'], extractDir);
    const topDirName = listing.stdout.split('\n').find((l) => l.trim().length > 0) || '';
    const repoRoot = join(extractDir, topDirName);
    const workDir = context.subdir ? join(repoRoot, context.subdir) : repoRoot;

    let logs = '';
    let pkgManager: ReturnType<typeof detectPackageManager> = 'npm';
    let buildCommand = '';
    let ok = false;

    // Detect Node project
    if (existsSync(join(workDir, 'package.json'))) {
      pkgManager = detectPackageManager(workDir);
      // Install
      let install: { status: number; stdout: string; stderr: string };
      if (pkgManager === 'pnpm') {
        install = run('pnpm', ['install', '--frozen-lockfile'], workDir);
      } else if (pkgManager === 'yarn') {
        install = run('yarn', ['install', '--frozen-lockfile'], workDir);
      } else if (pkgManager === 'bun') {
        install = run('bun', ['install'], workDir);
      } else {
        // npm
        const hasLock = existsSync(join(workDir, 'package-lock.json'));
        install = run('npm', [hasLock ? 'ci' : 'install'], workDir);
      }
      logs += `INSTALL (${pkgManager}):\n${install.stdout}\n${install.stderr}\n`;
      if (install.status !== 0) {
        return { ok: false, buildCommand, packageManager: pkgManager, logs, workspacePath: workDir };
      }

      // Determine build script
      try {
        const pkg = JSON.parse(readFileSync(join(workDir, 'package.json'), 'utf8')) as any;
        if (pkg?.scripts?.build) {
          buildCommand = `${pkgManager} run build`;
        } else {
          // fallback: try tsc if present
          buildCommand = pkgManager === 'pnpm' ? 'pnpm exec tsc -p .' : pkgManager === 'yarn' ? 'yarn tsc -p .' : pkgManager === 'bun' ? 'bun x tsc -p .' : 'npx -y tsc -p .';
        }
      } catch {
        buildCommand = pkgManager === 'pnpm' ? 'pnpm exec tsc -p .' : pkgManager === 'yarn' ? 'yarn tsc -p .' : pkgManager === 'bun' ? 'bun x tsc -p .' : 'npx -y tsc -p .';
      }

      // Run build
      let buildRes: { status: number; stdout: string; stderr: string };
      if (buildCommand === `${pkgManager} run build`) {
        const args = pkgManager === 'pnpm' ? ['run', '-r', 'build'] : ['run', 'build'];
        buildRes = run(pkgManager, args, workDir, { CI: 'true' });
      } else {
        // Split command for exec
        const [bin, ...args] = buildCommand.split(' ');
        buildRes = run(bin, args, workDir, { CI: 'true' });
      }
      logs += `BUILD: ${buildCommand}\n${buildRes.stdout}\n${buildRes.stderr}\n`;
      ok = buildRes.status === 0;
      return { ok, buildCommand, packageManager: pkgManager, logs, workspacePath: workDir };
    }

    // Unknown project type
    logs += 'No package.json found; skipping build.\n';
    return { ok: true, logs, workspacePath: workDir };
  },
});

export type LocalBuildCheckInput = z.infer<typeof localBuildCheckTool.inputSchema>;
export type LocalBuildCheckOutput = z.infer<typeof localBuildCheckTool.outputSchema>;


