import express from 'express';
import pino from 'pino';
import { prisma } from './lib/prisma.js';

export function createApp() {
  const app = express();
  const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

  app.use(express.json());
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

  return app;
}
