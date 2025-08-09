import { FreestyleSandboxes } from "freestyle-sandboxes";

const freestyle = new FreestyleSandboxes();

async function execAndLog(
  process: {
    exec: (
      cmd: string,
      background?: boolean
    ) => Promise<{
      id: string;
      isNew: boolean;
      stdout?: string[];
      stderr?: string[];
    }>;
  },
  cmd: string,
  background = false
) {
  console.log(`$ ${cmd}`);
  const result = await process.exec(cmd, background);
  if (result.stdout && result.stdout.length > 0) {
    console.log(result.stdout.join("\n"));
  }
  if (result.stderr && result.stderr.length > 0) {
    console.error(result.stderr.join("\n"));
  }
  console.log(`run id: ${result.id} (new: ${result.isNew})`);
  return result;
}

function generateEnvFileContents() {
  const envKeys = [
    "DATABASE_URL",
    "DIRECT_URL",
    "SENTRY_AUTH_TOKEN",
    "SENTRY_ORG",
    "SENTRY_PROJECT",
    "SENTRY_DSN",
    "ALERT_INTEGRATION_NAME",
    "WEBHOOK_SECRET",
  ] as const;

  const missingEnvKeys: string[] = [];
  const lines: string[] = [];

  for (const key of envKeys) {
    const value = process.env[key];
    if (value === undefined) {
      missingEnvKeys.push(key);
      continue;
    }
    lines.push(`${key}=${value}`);
  }

  return lines.join("\n") + "\n";
}

async function execViaApi(
  devServer: { repoId: string; kind: "repo" },
  command: string,
  background = false
): Promise<{
  id: string;
  isNew: boolean;
  stdout?: string[];
  stderr?: string[];
}> {
  const res = await freestyle.fetch("/ephemeral/v1/dev-servers/exec", {
    method: "POST",
    body: JSON.stringify({
      devServer,
      command,
      background,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Exec API failed (${res.status} ${res.statusText}): ${text}`
    );
  }
  const data = await res.json();
  return {
    id: data.id,
    isNew: data.isNew,
    stdout: data.stdout ?? undefined,
    stderr: data.stderr ?? undefined,
  };
}

export async function initFreestyleSandbox() {
  const { repoId } = await freestyle.createGitRepository({
    name: `yc-hackathon-social-dev-${Math.random().toString(36).substring(2, 8)}`,
    import: {
      commit_message: "Import from GitHub",
      type: "git",
      url: "https://github.com/antonioAEMartins/yc-hackathon-social",
      branch: "dev",
    },
  });

  const devServer = await freestyle.requestDevServer({ repoId: repoId });
  console.log(`Dev Server URL: ${devServer.ephemeralUrl}`);

  const devServerRef = { repoId, kind: "repo" as const };
  const apiProcess = {
    exec: (cmd: string, background = false) =>
      execViaApi(devServerRef, cmd, background),
  };

  await execAndLog(apiProcess, "cd /template");
  await execAndLog(apiProcess, "git checkout dev");
  await execAndLog(apiProcess, `echo  \"${generateEnvFileContents()}\" > .env`);
  await execAndLog(apiProcess, "systemctl restart freestyle-run-dev");

  return devServer.ephemeralUrl;
}
