
import 'dotenv/config';
import { Mastra } from '@mastra/core/mastra';
import { registerApiRoute } from '@mastra/core/server';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { githubWorkflow } from './workflows/github-workflow';
import { githubAgent } from './agents/github-agent';
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
  workflows: { githubWorkflow },
  agents: { githubAgent },
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
          const mastra = c.get('mastra');
          const logger = (mastra as any)?.logger ?? console;

          const rawText = await c.req.text();
          const signature = c.req.header('Sentry-Hook-Signature') || c.req.header('X-Sentry-Signature');
          const resource = c.req.header('Sentry-Hook-Resource');
          const timestamp = c.req.header('Sentry-Hook-Timestamp');

          const secret = process.env.WEBHOOK_SECRET ?? '';
          const isValid = verifySignature(rawText, signature, secret);

          let payload: unknown = null;
          try {
            payload = JSON.parse(rawText);
          } catch {
            payload = null;
          }

          try {
            logger.info?.('--- Incoming Sentry webhook ---');
            logger.info?.({ isValid, resource, timestamp }, 'Sentry webhook metadata');
            logger.info?.(payload ?? rawText, 'Sentry webhook payload');
            logger.info?.('--------------------------------');
          } catch {
            // no-op logging errors
          }

          if ((secret && secret.length > 0) && !isValid) {
            return c.json({ status: 'invalid signature' }, 400);
          }

          return c.json({ status: 'ok' }, 200);
        },
      }),
    ],
  },
});
