import { prisma } from '../db.js';

async function listTables() {
  try {
    const tables: any = await prisma.$queryRaw`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`;
    console.log('Tables currently in database:');
    tables.forEach((t: any) => console.log(' -', t.name));

    // Check if OtpVerification exists
    const otpTable = tables.find((t: any) => t.name.toLowerCase() === 'otpverification');
    console.log('\nOtpVerification table exists:', Boolean(otpTable));
  } catch (err) {
    console.error('Error querying sqlite_master:', err);
  } finally {
    await prisma.$disconnect();
  }
}

listTables();
