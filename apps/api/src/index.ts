import crypto from 'node:crypto';
import express, { type Request } from 'express';
import pino from 'pino';
import { z } from 'zod';
import { prisma } from './lib/prisma.js';
import { startVapiCall } from './lib/vapi.js';

type RequestWithRawBody = Request & { rawBody?: string };

const startCallSchema = z.object({
  to: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Phone must be in E.164 format'),
  campaignType: z.string().min(1),
  context: z.record(z.string(), z.unknown()).optional()
});

const webhookSchema = z.object({
  id: z.string(),
  type: z.string(),
  call: z
    .object({
      id: z.string().optional(),
      status: z.string().optional()
    })
    .optional(),
  callId: z.string().optional(),
  status: z.string().optional()
});

function verifyVapiSignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function mapVapiStatusToCallStatus(status?: string):
  | 'queued'
  | 'initiated'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | null {
  if (!status) return null;

  if (status === 'in-progress') return 'in_progress';
  if (status === 'completed' || status === 'ended') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'queued') return 'queued';
  if (status === 'initiated') return 'initiated';

  return null;
}

export function createApp() {
  const app = express();
  const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as RequestWithRawBody).rawBody = buf.toString('utf8');
      }
    })
  );

  app.use((req, _res, next) => {
    logger.info({ method: req.method, path: req.path }, 'request');
    next();
  });

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/db-status', async (_req, res) => {
    try {
      // Log environment info (without exposing full connection string)
      const dbUrl = process.env.DATABASE_URL;
      const hasDbUrl = !!dbUrl;
      const dbUrlPrefix = dbUrl ? dbUrl.substring(0, 20) + '...' : 'not set';

      logger.info({
        hasDbUrl,
        dbUrlPrefix,
        nodeEnv: process.env.NODE_ENV
      }, 'Database connection attempt');

      // Test basic connection
      await prisma.$queryRaw`SELECT 1 as test`;

      // Count records in each table
      const [accounts, teams, calls] = await Promise.all([
        prisma.account.count(),
        prisma.team.count(),
        prisma.call.count()
      ]);

      res.status(200).json({
        database: 'connected',
        environment: {
          hasDbUrl,
          nodeEnv: process.env.NODE_ENV
        },
        counts: { accounts, teams, calls }
      });
    } catch (error) {
      logger.error({
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : error,
        hasDbUrl: !!process.env.DATABASE_URL,
        nodeEnv: process.env.NODE_ENV
      }, 'db-status check failed');

      res.status(500).json({
        database: 'error',
        errorName: error instanceof Error ? error.name : 'Unknown',
        error: error instanceof Error ? error.message : String(error),
        environment: {
          hasDbUrl: !!process.env.DATABASE_URL,
          nodeEnv: process.env.NODE_ENV
        }
      });
    }
  });

  app.get('/db-health', async (_req, res) => {
    try {
      // First, test basic database connection
      await prisma.$queryRaw`SELECT 1`;

      // Check if team exists, create if not
      const teamId = 'team_clawsim_demo';
      let team = await prisma.team.findUnique({ where: { id: teamId } });

      if (!team) {
        // Create account first
        const account = await prisma.account.create({
          data: { name: 'Demo Account' }
        });

        // Create team
        team = await prisma.team.create({
          data: {
            id: teamId,
            accountId: account.id,
            name: 'Demo Team'
          }
        });
      }

      const call = await prisma.call.create({
        data: {
          teamId,
          toNumber: '+12025550188',
          status: 'queued'
        }
      });

      const fetched = await prisma.call.findUnique({
        where: { id: call.id }
      });

      res.status(200).json({
        success: true,
        created: call,
        fetched,
        team: team
      });
    } catch (error) {
      logger.error({
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name,
          code: (error as any).code
        } : error
      }, 'db-check failed');
      res.status(500).json({
        error: 'db-check failed',
        details: error instanceof Error ? error.message : String(error),
        code: (error as any)?.code
      });
    }
  });

  app.post('/v1/calls/start', async (req, res) => {
    const parsed = startCallSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        issues: parsed.error.flatten()
      });
    }

    const { to, campaignType, context } = parsed.data;
    const assistantId = process.env.VAPI_ASSISTANT_ID;

    if (!assistantId) {
      return res.status(500).json({ error: 'VAPI_ASSISTANT_ID is not set' });
    }

    const teamId = 'team_clawsim_demo';

    try {
      const createdCall = await prisma.call.create({
        data: {
          teamId,
          toNumber: to,
          status: 'queued'
        }
      });

      const vapiCall = await startVapiCall({
        to,
        assistantId,
        metadata: {
          campaignType,
          context,
          internalCallId: createdCall.id
        }
      });

      await prisma.call.update({
        where: { id: createdCall.id },
        data: {
          externalCallId: vapiCall.id,
          status: 'initiated'
        }
      });

      return res.status(200).json({ callId: createdCall.id, status: 'initiated' });
    } catch (error) {
      logger.error({
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error
      }, 'failed to start call');
      return res.status(500).json({
        error: 'Failed to start call',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post('/v1/webhooks/vapi', async (req, res) => {
    const signature = req.header('x-vapi-signature');
    const secret = process.env.VAPI_WEBHOOK_SECRET;
    const rawBody = (req as RequestWithRawBody).rawBody;

    if (!signature || !secret || !rawBody) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    if (!verifyVapiSignature(rawBody, signature, secret)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const parsed = webhookSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    const payload = parsed.data;

    try {
      const matchedCall = payload.call?.id
        ? await prisma.call.findFirst({ where: { externalCallId: payload.call.id } })
        : null;

      await prisma.webhookEvent.create({
        data: {
          externalEventId: payload.id,
          eventType: payload.type,
          payload,
          callId: matchedCall?.id
        }
      });

      const status = mapVapiStatusToCallStatus(payload.call?.status ?? payload.status);

      if (matchedCall && status) {
        await prisma.call.update({
          where: { id: matchedCall.id },
          data: { status }
        });
      }

      return res.status(200).json({ ok: true });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === 'P2002'
      ) {
        return res.status(200).json({ ok: true, duplicate: true });
      }

      logger.error({ error }, 'vapi webhook processing failed');
      return res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  return app;
}
