
import 'dotenv/config';
import { Mastra } from '@mastra/core/mastra';
import { registerApiRoute } from '@mastra/core/server';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { sambaWorkflow, startSambaWorkflow } from './workflows/samba-workflow.js';
import { createHmac } from 'node:crypto';

function verifySignature(rawPayload: string, signatureHeader: string | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length === 0) return true;
  if (!signatureHeader) return false;
  try {
    const computed = createHmac('sha256', Buffer.from(secret, 'utf-8'))
      .update(Buffer.from(rawPayload, 'utf-8'))
      .digest('hex');
    return computed === signatureHeader;
  } catch {
    return false;
  }
}

export const mastra = new Mastra({
  workflows: { sambaWorkflow },
  agents: {},
  storage: new LibSQLStore({
    // stores telemetry, evals, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ":memory:",
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  server: {
    apiRoutes: [
      registerApiRoute('/webhook', {
        method: 'POST',
        handler: async (c) => {
          const rawText = await c.req.text();
          const signature = c.req.header('Sentry-Hook-Signature') || c.req.header('X-Sentry-Signature');
          const resource = c.req.header('Sentry-Hook-Resource');
          const timestamp = c.req.header('Sentry-Hook-Timestamp');

          const secret = process.env.WEBHOOK_SECRET ?? '';
          const isValid = verifySignature(rawText, signature, secret);

          let payload: unknown = null;
          try {
            payload = JSON.parse(rawText);
            const payloadString = JSON.stringify(payload, null, 2);
            console.log('[webhook] payload', payloadString);
          } catch {
            payload = null;
          }

          try {
            console.log('[webhook] Sentry webhook received', { isValid, resource, timestamp });
          } catch {}

          if ((secret && secret.length > 0) && !isValid) {
            return c.json({ status: 'invalid signature' }, 400);
          }

          // Kick off samba-workflow if this is a Sentry event_alert
          try {
            const p = payload as any;
            try {
              console.log('[webhook] payload overview', {
                hasPayload: !!p,
                resourceHeader: resource,
                payloadResource: p?.resource,
                hasData: !!p?.data,
                hasEvent: !!p?.data?.event,
              });
            } catch {}
            const isEventAlert = (resource === 'event_alert') || (p?.resource === 'event_alert');
            if (p && p.data && p.data.event && isEventAlert) {
              try { console.log('[webhook] event_alert detected', { via: resource === 'event_alert' ? 'header' : 'payload' }); } catch {}
              const evt = p.data.event;

              // Try to extract stack from breadcrumbs first
              let stack: string | undefined;
              const crumbs = evt?.breadcrumbs?.values ?? [];
              for (const crumb of crumbs) {
                const s = crumb?.data?.arguments?.[0]?.stack;
                if (typeof s === 'string' && s.length > 0) { stack = s; break; }
              }

              // Extract file path hint
              let filePath: string | undefined;
              const msg = crumbs?.[0]?.data?.arguments?.[0]?.message || evt?.message || evt?.metadata?.title || '';
              const m = /(?:at|Error at:)\s+([^\s:]+):(\d+)/i.exec(String(msg));
              if (m) { filePath = m[1]; }

              // Fallbacks: scan metadata.value/title/exception.values[*].value for repo-relative path hints like src/...ext
              const findPathInString = (s?: string) => {
                if (!s) return undefined;
                const mm = /(src\/[A-Za-z0-9_.\-\/]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rb|go|java|cs|php|md))/i.exec(s);
                return mm ? mm[1] : undefined;
              };
              if (!filePath) {
                filePath = findPathInString((evt as any)?.metadata?.value) || findPathInString((evt as any)?.title);
              }
              if (!filePath && Array.isArray((evt as any)?.exception?.values)) {
                for (const val of (evt as any).exception.values) {
                  const cand = findPathInString(String(val?.value || ''));
                  if (cand) { filePath = cand; break; }
                }
              }

              // Resolve owner/repo from env mapping
              const mapRaw = process.env.SENTRY_PROJECT_REPO_MAP || '';
              let owner: string | undefined;
              let repo: string | undefined;
              let branch: string | undefined;
              try {
                if (mapRaw && mapRaw.trim().length > 0) {
                  const map = JSON.parse(mapRaw);
                  const key = String(evt.project ?? '');
                  const conf = map[key] || map.default;
                  if (typeof conf === 'string') {
                    const u = new URL(conf);
                    const parts = u.pathname.split('/').filter(Boolean);
                    owner = parts[0];
                    repo = parts[1];
                  } else if (conf && typeof conf === 'object') {
                    owner = conf.owner; repo = conf.repo; branch = conf.branch;
                  }
                }
              } catch {}
              if (!owner || !repo) {
                const defUrl = process.env.SENTRY_DEFAULT_REPO_URL || '';
                if (defUrl) {
                  try {
                    const u = new URL(defUrl);
                    const parts = u.pathname.split('/').filter(Boolean);
                    owner = parts[0]; repo = parts[1];
                  } catch {}
                }
                // Demo fallback if mapping/env not provided
                if (!owner || !repo) {
                  owner = 'AntonioAEMartins';
                  repo = 'yc-hackathon-social';
                }
              }

              const repoUrl = owner && repo && filePath
                ? `https://github.com/${owner}/${repo}/blob/${branch || 'main'}/${filePath}`
                : undefined;

              const promptSections: string[] = [];
              promptSections.push('Stack trace:');
              promptSections.push(stack || (evt?.logentry?.formatted ?? evt?.message ?? ''));
              if (repoUrl) { promptSections.push('\nRepo URL:'); promptSections.push(repoUrl); }
              if (filePath) { promptSections.push('\nFile relative path:'); promptSections.push(filePath); }
              const prompt = promptSections.join('\n');

              const prTitle = evt?.metadata?.title || evt?.message || evt?.logentry?.formatted || 'Automated fix from Sentry alert';
              const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN || undefined;
              const input = { prompt, owner, repo, prTitle, token } as any;

              // Start run and log details
              console.log('[samba-workflow] starting', { owner, repo, filePath, promptSize: prompt.length });
              try {
                // Prefer native start; if unavailable, run manual runner
                const wfObj = (sambaWorkflow as any);
                const directStart = wfObj?.start;
                console.log('[samba-workflow] directStart available?', !!directStart);
                if (typeof directStart === 'function') {
                  const run = await directStart({ inputData: input });
                  console.log('[samba-workflow] started', { runId: run?.id });
                  return c.json({ status: 'ok', started: true, workflow: 'samba-workflow', runId: run?.id }, 202);
                }

                console.log('[samba-workflow] falling back to manual runner');
                const pr = await startSambaWorkflow(input);
                return c.json({ status: 'ok', started: true, workflow: 'samba-workflow', pr }, 202);
              } catch (errStart) {
                console.error('[samba-workflow] failed_to_start', String(errStart));
                return c.json({ status: 'ok', started: false, error: 'failed_to_start' }, 200);
              }
            }
            // Not an event_alert or missing event
            console.log('[webhook] skipped payload (not event_alert or missing event)');
          } catch (err) {
            try { console.error('[webhook] processing_error', String(err)); } catch {}
          }

          return c.json({ status: 'ok', started: false }, 200);
        },
      }),
    ],
  },
});
