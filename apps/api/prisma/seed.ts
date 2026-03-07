import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const account = await prisma.account.upsert({
    where: { id: 'acct_clawsim_demo' },
    update: {},
    create: {
      id: 'acct_clawsim_demo',
      name: 'Clawsim Demo Account'
    }
  });

  const team = await prisma.team.upsert({
    where: { id: 'team_clawsim_demo' },
    update: {},
    create: {
      id: 'team_clawsim_demo',
      accountId: account.id,
      name: 'Demo Team'
    }
  });

  const phone = await prisma.phoneNumber.upsert({
    where: { e164: '+12025550111' },
    update: {},
    create: {
      teamId: team.id,
      e164: '+12025550111',
      provider: 'twilio',
      country: 'US',
      isActive: true
    }
  });

  const call = await prisma.call.create({
    data: {
      teamId: team.id,
      phoneNumberId: phone.id,
      toNumber: '+12025550123',
      fromNumber: phone.e164,
      status: 'queued'
    }
  });

  console.log('Seeded demo call:', call.id);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
