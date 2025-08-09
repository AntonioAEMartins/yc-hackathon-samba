import { FreestyleSandboxes } from "freestyle-sandboxes";
import "dotenv/config";

console.log("Starting Freestyle Sandboxes");

const freestyle = new FreestyleSandboxes();

const socialRepoId = "7f0ad782-e382-4655-8a7b-cebdff2552e3";
console.log("Requesting dev server");
// gitRef: "dev"
const devServer = await freestyle.requestDevServer({ repoId: socialRepoId });
devServer.process.exec("cd /template && git checkout dev")

console.log(`Dev Server URL: ${devServer.ephemeralUrl}`);

// Create/update a .env file on the dev server with selected variables
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
