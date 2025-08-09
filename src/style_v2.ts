import { FreestyleSandboxes } from "freestyle-sandboxes";

const freestyle = new FreestyleSandboxes();

const { repoId } = await freestyle.createGitRepository({
  name: 'yc-hackathon-social-dev',
  source: {
    type: 'git',
    url: 'https://github.com/antonioAEMartins/yc-hackathon-social',
    branch: 'dev', // Optional: specify branch to checkout
    depth: 0, // Optional: shallow clone
  }
})

const devServer = await freestyle.requestDevServer({ repoId: repoId });
console.log(`Dev Server URL: ${devServer.ephemeralUrl}`);

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

const envFileContents = lines.join("\n") + "\n";
await devServer.fs.writeFile(".env", envFileContents);
console.log("Wrote .env to the dev server with keys:", envKeys.filter((k) => !missingEnvKeys.includes(k)).join(", "));
if (missingEnvKeys.length > 0) {
  console.warn("Missing values for keys (not written):", missingEnvKeys.join(", "));
}

console.log(envFileContents);
