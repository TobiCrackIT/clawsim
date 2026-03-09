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

  app.post('/dev/db-check', async (_req, res) => {
    try {
      const teamId = 'team_clawsim_demo';

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

      res.status(200).json({ created: call, fetched });
    } catch (error) {
      logger.error({ error }, 'db-check failed');
      res.status(500).json({ error: 'db-check failed' });
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
      logger.error({ error }, 'failed to start call');
      return res.status(500).json({ error: 'Failed to start call' });
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
