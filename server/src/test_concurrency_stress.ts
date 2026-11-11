import { prisma } from './db.js';
import { callIntelligenceService } from './services/callIntelligence.js';

async function runConcurrencyStressTest() {
  console.log('\n================================================================');
  console.log('⚡ KAIRA VOICE AI – DATABASE CONCURRENCY & STRESS TEST');
  console.log('================================================================\n');

  const CONCURRENT_CALLS = 10;
  const TRANSCRIPTS_PER_CALL = 6;
  console.log(`Simulating ${CONCURRENT_CALLS} simultaneous active voice calls...`);
  console.log(`Writing ${TRANSCRIPTS_PER_CALL} concurrent transcripts per call (${CONCURRENT_CALLS * TRANSCRIPTS_PER_CALL} total writes)...`);

  const startTime = Date.now();
  let lockErrors = 0;
  let totalErrors = 0;
  const createdCallIds: string[] = [];

  // Phase 1: Concurrently create 10 CallRecords
  console.log('\n--- Step 1: Concurrent CallRecord Creation ---');
  const callCreationPromises = Array.from({ length: CONCURRENT_CALLS }).map(async (_, idx) => {
    const callId = `stress_call_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      const call = await prisma.callRecord.create({
        data: {
          callId,
          customerName: `Stress Test User ${idx + 1}`,
          customerPhone: `+91999990000${idx}`,
          status: 'active',
          direction: 'incoming',
          type: 'customer_support',
          language: idx % 2 === 0 ? 'ta' : 'en',
          startTime: new Date()
        }
      });
      createdCallIds.push(call.id);
      return { success: true, id: call.id, callId };
    } catch (err: any) {
      totalErrors++;
      if (err.message?.includes('SQLITE_BUSY') || err.message?.includes('locked')) {
        lockErrors++;
      }
      return { success: false, error: err.message };
    }
  });

  const createdResults = await Promise.all(callCreationPromises);
  const successfulCalls = createdResults.filter(r => r.success);
  console.log(`  Calls Created Successfully: ${successfulCalls.length} / ${CONCURRENT_CALLS}`);

  // Phase 2: Simultaneous Transcripts writes across all calls concurrently
  console.log('\n--- Step 2: High-Frequency Concurrent Transcript Writes ---');
  const transcriptPromises: Promise<any>[] = [];

  for (const callRes of successfulCalls) {
    for (let tIdx = 0; tIdx < TRANSCRIPTS_PER_CALL; tIdx++) {
      transcriptPromises.push(
        (async () => {
          try {
            await prisma.callTranscript.create({
              data: {
                callRecordId: callRes.id!,
                sender: tIdx % 2 === 0 ? 'customer' : 'agent',
                senderName: tIdx % 2 === 0 ? 'Customer' : 'Agent',
                text: `Stress transcript turn #${tIdx + 1} for call ${callRes.callId} testing continuous database streaming.`,
                language: 'en'
              }
            });
            return { success: true };
          } catch (err: any) {
            totalErrors++;
            if (err.message?.includes('SQLITE_BUSY') || err.message?.includes('locked')) {
              lockErrors++;
            }
            return { success: false, error: err.message };
          }
        })()
      );
    }
  }

  const transcriptResults = await Promise.all(transcriptPromises);
  const successfulTranscripts = transcriptResults.filter(r => r.success);
  console.log(`  Transcripts Written Successfully: ${successfulTranscripts.length} / ${CONCURRENT_CALLS * TRANSCRIPTS_PER_CALL}`);

  // Phase 3: Simultaneous Telemetry Updates
  console.log('\n--- Step 3: Concurrent Telemetry & Call State Finalization ---');
  const updatePromises = successfulCalls.map(async (c, idx) => {
    try {
      await prisma.callRecord.update({
        where: { id: c.id },
        data: {
          status: 'completed',
          duration: 45 + idx * 5,
          quality: 'Good',
          avgLatency: 85 + idx * 2,
          packetLoss: 0.1,
          jitter: 5.2,
          callNotes: `Stress test run verified successfully for slot ${idx}.`
        }
      });
      return { success: true };
    } catch (err: any) {
      totalErrors++;
      if (err.message?.includes('SQLITE_BUSY') || err.message?.includes('locked')) {
        lockErrors++;
      }
      return { success: false, error: err.message };
    }
  });

  const updateResults = await Promise.all(updatePromises);
  const successfulUpdates = updateResults.filter(r => r.success);
  console.log(`  Call Telemetry Finalized: ${successfulUpdates.length} / ${successfulCalls.length}`);

  // Phase 4: Concurrent Post-Call Intelligence processing
  console.log('\n--- Step 4: Concurrent Post-Call Intelligence & Follow-Up Allocations ---');
  const intelPromises = successfulCalls.slice(0, 5).map(async (c) => {
    try {
      const intel = await callIntelligenceService.processCall(c.id!, true);
      return { success: Boolean(intel) };
    } catch (err: any) {
      totalErrors++;
      if (err.message?.includes('SQLITE_BUSY') || err.message?.includes('locked')) {
        lockErrors++;
      }
      return { success: false, error: err.message };
    }
  });

  const intelResults = await Promise.all(intelPromises);
  const successfulIntel = intelResults.filter(r => r.success);
  console.log(`  Intelligence Records Generated: ${successfulIntel.length} / 5`);

  // Phase 5: Verification of Data Integrity & Duplicates
  console.log('\n--- Step 5: Data Integrity & Deduplication Audit ---');
  const verifyCalls = await prisma.callRecord.findMany({
    where: { id: { in: createdCallIds } },
    include: { transcripts: true, intelligence: true }
  });

  const totalSavedTranscripts = verifyCalls.reduce((acc, c) => acc + c.transcripts.length, 0);
  console.log(`  Total CallRecords in DB: ${verifyCalls.length} (Expected: ${successfulCalls.length})`);
  console.log(`  Total Transcripts in DB: ${totalSavedTranscripts} (Expected: ${successfulTranscripts.length})`);

  // Check for duplicates
  const callIdsSet = new Set(verifyCalls.map(c => c.callId));
  const hasDuplicateCallIds = callIdsSet.size !== verifyCalls.length;
  console.log(`  Duplicate Call Records Detected: ${hasDuplicateCallIds ? 'YES (FAIL)' : 'NONE (PASS)'}`);

  const totalDurationMs = Date.now() - startTime;
  console.log('\n================================================================');
  console.log('📊 CONCURRENCY STRESS TEST SUMMARY');
  console.log('================================================================');
  console.log(`  Total Duration: ${totalDurationMs} ms`);
  console.log(`  Total Operations: ${CONCURRENT_CALLS + (CONCURRENT_CALLS * TRANSCRIPTS_PER_CALL) + CONCURRENT_CALLS + 5}`);
  console.log(`  Total Errors: ${totalErrors}`);
  console.log(`  Database Lock (SQLITE_BUSY) Errors: ${lockErrors}`);
  console.log(`  Concurrency Health: ${lockErrors === 0 && totalErrors === 0 ? 'HEALTHY FOR PILOT' : 'BOTTLENECK DETECTED'}`);
  console.log('================================================================\n');

  // Clean up stress test calls to keep database tidy
  await prisma.callRecord.deleteMany({
    where: { id: { in: createdCallIds } }
  });

  if (totalErrors > 0) {
    process.exit(1);
  }
}

runConcurrencyStressTest().catch(err => {
  console.error('Stress Test Crashed:', err);
  process.exit(1);
});

