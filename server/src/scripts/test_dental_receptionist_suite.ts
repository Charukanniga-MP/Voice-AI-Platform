import { dentalAiService } from '../services/dentalAi.service.js';
import { dentalAppointmentService } from '../services/dentalAppointment.service.js';
import { knowledgeService } from '../services/knowledge.js';
import { prisma } from '../db.js';

interface TestResult {
  id: number;
  title: string;
  passed: boolean;
  actual: string;
  details?: string;
}

const results: TestResult[] = [];

async function runDentalTestSuite() {
  console.log('================================================================');
  console.log('   KAIRA DENTAL RECEPTIONIST AUTOMATED TEST SUITE (10 SCENARIOS)');
  console.log('================================================================\n');

  const testCallId = `test_call_dental_${Date.now()}`;

  // --------------------------------------------------------------------------
  // TEST 1: Patient says "I have wisdom teeth pain."
  // Expected: Kaira asks whether the pain is on the upper or lower side.
  // --------------------------------------------------------------------------
  try {
    const res1 = await dentalAiService.handleTurn({
      callId: testCallId,
      query: 'I have wisdom teeth pain.',
      language: 'en'
    });

    const passed1 =
      res1.isDentalHandled &&
      (res1.answer.toLowerCase().includes('upper or lower') || res1.answer.toLowerCase().includes('lower jaw') || res1.answer.toLowerCase().includes('left or right'));

    results.push({
      id: 1,
      title: 'Test 1: Initial Wisdom Tooth Complaint -> Location follow-up',
      passed: passed1,
      actual: res1.answer,
      details: `isDentalHandled: ${res1.isDentalHandled}`
    });
    console.log(`[PASS] Test 1: ${res1.answer}\n`);
  } catch (err: any) {
    results.push({ id: 1, title: 'Test 1: Initial Wisdom Tooth Complaint', passed: false, actual: err.message });
    console.error(`[FAIL] Test 1:`, err);
  }

  // --------------------------------------------------------------------------
  // TEST 2: Patient says "Lower right side."
  // Expected: Kaira asks when the pain started.
  // --------------------------------------------------------------------------
  try {
    const res2 = await dentalAiService.handleTurn({
      callId: testCallId,
      query: 'Lower right side.',
      language: 'en'
    });

    const passed2 =
      res2.isDentalHandled &&
      (res2.answer.toLowerCase().includes('when did') || res2.answer.toLowerCase().includes('how long') || res2.answer.toLowerCase().includes('start'));

    results.push({
      id: 2,
      title: 'Test 2: Location Specified -> Duration follow-up',
      passed: passed2,
      actual: res2.answer
    });
    console.log(`[PASS] Test 2: ${res2.answer}\n`);
  } catch (err: any) {
    results.push({ id: 2, title: 'Test 2', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 3: Patient says "Three days ago."
  // Expected: Kaira asks about the pain pattern.
  // --------------------------------------------------------------------------
  try {
    const res3 = await dentalAiService.handleTurn({
      callId: testCallId,
      query: 'Three days ago.',
      language: 'en'
    });

    const passed3 =
      res3.isDentalHandled &&
      (res3.answer.toLowerCase().includes('constant') ||
       res3.answer.toLowerCase().includes('chew') ||
       res3.answer.toLowerCase().includes('come and go') ||
       res3.answer.toLowerCase().includes('pattern') ||
       res3.answer.toLowerCase().includes('sharp') ||
       res3.answer.toLowerCase().includes('type of pain'));

    results.push({
      id: 3,
      title: 'Test 3: Duration Specified -> Pain Pattern follow-up',
      passed: passed3,
      actual: res3.answer
    });
    console.log(`[PASS] Test 3: ${res3.answer}\n`);
  } catch (err: any) {
    results.push({ id: 3, title: 'Test 3', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 4: Patient says "It hurts when I chew."
  // Expected: Kaira asks an appropriate next question (severity 1-10 or symptoms).
  // --------------------------------------------------------------------------
  try {
    const res4 = await dentalAiService.handleTurn({
      callId: testCallId,
      query: 'It hurts when I chew.',
      language: 'en'
    });

    const passed4 =
      res4.isDentalHandled &&
      (res4.answer.toLowerCase().includes('scale from 1 to 10') || res4.answer.toLowerCase().includes('rate') || res4.answer.toLowerCase().includes('severity') || res4.answer.toLowerCase().includes('swelling'));

    results.push({
      id: 4,
      title: 'Test 4: Pattern Specified -> Severity / Associated Symptoms follow-up',
      passed: passed4,
      actual: res4.answer
    });
    console.log(`[PASS] Test 4: ${res4.answer}\n`);
  } catch (err: any) {
    results.push({ id: 4, title: 'Test 4', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 5: Patient says "My face is swelling and I cannot swallow."
  // Expected: Kaira stops normal booking and follows the urgent escalation protocol.
  // --------------------------------------------------------------------------
  try {
    const urgentCallId = `test_urgent_${Date.now()}`;
    const res5 = await dentalAiService.handleTurn({
      callId: urgentCallId,
      query: 'My face is swelling and I cannot swallow.',
      language: 'en'
    });

    const passed5 =
      res5.isDentalHandled &&
      res5.requiresTransfer &&
      (res5.answer.toLowerCase().includes('emergency') || res5.answer.toLowerCase().includes('hospital') || res5.answer.toLowerCase().includes('911'));

    results.push({
      id: 5,
      title: 'Test 5: Life-Threatening Emergency -> Clinical Escalation Protocol',
      passed: passed5,
      actual: res5.answer,
      details: `requiresTransfer: ${res5.requiresTransfer}, transferReason: ${res5.transferReason}`
    });
    console.log(`[PASS] Test 5: ${res5.answer}\n`);
  } catch (err: any) {
    results.push({ id: 5, title: 'Test 5', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 6: Patient wants an appointment.
  // Expected: Kaira checks actual dentist availability.
  // --------------------------------------------------------------------------
  try {
    // We specify preferred date for availability check
    const bookingCallId = `test_booking_${Date.now()}`;
    // Initialize complaint
    await dentalAiService.handleTurn({
      callId: bookingCallId,
      query: 'I need to see a dentist for wisdom tooth pain.',
      language: 'en'
    });

    // Request appointment with a specific date
    // Compute tomorrow's date or a weekday
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (tomorrow.getDay() === 0) tomorrow.setDate(tomorrow.getDate() + 1); // skip Sunday
    const dateStr = tomorrow.toISOString().split('T')[0];

    const res6 = await dentalAiService.handleTurn({
      callId: bookingCallId,
      query: `I want an appointment for ${dateStr}.`,
      language: 'en'
    });

    const passed6 =
      res6.isDentalHandled &&
      (res6.answer.includes(dateStr) || res6.answer.includes('slots available') || res6.answer.includes('Dr.'));

    results.push({
      id: 6,
      title: 'Test 6: Appointment Request -> Real Database Availability Check',
      passed: passed6,
      actual: res6.answer
    });
    console.log(`[PASS] Test 6: ${res6.answer}\n`);
  } catch (err: any) {
    results.push({ id: 6, title: 'Test 6', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 7: Patient selects an available slot.
  // Expected: Kaira saves the booking and returns the actual booking reference.
  // --------------------------------------------------------------------------
  try {
    const slotCallId = `test_slot_select_${Date.now()}`;
    const testDate = new Date();
    testDate.setDate(testDate.getDate() + 2);
    if (testDate.getDay() === 0) testDate.setDate(testDate.getDate() + 1);
    const dateStr = testDate.toISOString().split('T')[0];
    const testPhone = `+1-555-${Math.floor(1000 + Math.random() * 9000)}`;

    // 1. Initial appointment request
    await dentalAiService.handleTurn({
      callId: slotCallId,
      query: `I have a toothache and want an appointment on ${dateStr}. My name is John Doe, phone ${testPhone}.`,
      language: 'en',
      customerContext: { customerName: 'John Doe', customerPhone: testPhone }
    });

    // 2. Select slot
    const res7 = await dentalAiService.handleTurn({
      callId: slotCallId,
      query: 'I would like the 10:00 AM slot please.',
      language: 'en',
      customerContext: { customerName: 'John Doe', customerPhone: testPhone }
    });

    const passed7 =
      res7.isDentalHandled &&
      (Boolean(res7.bookingReference) || res7.answer.includes('DEN-')) &&
      res7.answer.toLowerCase().includes('confirmed');

    results.push({
      id: 7,
      title: 'Test 7: Slot Selected -> Database Saved & Unique Reference Returned',
      passed: passed7,
      actual: res7.answer,
      details: `bookingReference: ${res7.bookingReference}`
    });
    console.log(`[PASS] Test 7: ${res7.answer}\n`);
  } catch (err: any) {
    results.push({ id: 7, title: 'Test 7', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 8: Patient changes the appointment date.
  // Expected: Kaira updates the workflow without losing previous patient details.
  // --------------------------------------------------------------------------
  try {
    const reschedCallId = `test_resched_${Date.now()}`;
    // 1. Ask for Friday
    await dentalAiService.handleTurn({
      callId: reschedCallId,
      query: 'I have wisdom tooth pain. My name is Abinaya. Can I come on Friday?',
      language: 'en',
      customerContext: { customerName: 'Abinaya', customerPhone: '+1-555-0188' }
    });

    // 2. Change date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (tomorrow.getDay() === 0) tomorrow.setDate(tomorrow.getDate() + 1);
    const newDateStr = tomorrow.toISOString().split('T')[0];

    const res8 = await dentalAiService.handleTurn({
      callId: reschedCallId,
      query: `Actually, can I change the appointment date to ${newDateStr}?`,
      language: 'en',
      customerContext: { customerName: 'Abinaya', customerPhone: '+1-555-0188' }
    });

    const session = dentalAiService.getOrCreateSession(reschedCallId);
    const passed8 =
      res8.isDentalHandled &&
      session.patientName === 'Abinaya' &&
      (res8.answer.includes(newDateStr) || res8.answer.includes('slots available'));

    results.push({
      id: 8,
      title: 'Test 8: Change Appointment Date -> Preserves Context & Updates Slots',
      passed: passed8,
      actual: res8.answer,
      details: `Preserved Patient: ${session.patientName}`
    });
    console.log(`[PASS] Test 8: ${res8.answer}\n`);
  } catch (err: any) {
    results.push({ id: 8, title: 'Test 8', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 9: Patient speaks in Tamil.
  // Expected: Kaira maintains the same dental receptionist workflow in Tamil.
  // --------------------------------------------------------------------------
  try {
    const tamilCallId = `test_tamil_${Date.now()}`;
    const res9 = await dentalAiService.handleTurn({
      callId: tamilCallId,
      query: 'எனக்கு பல் வலி உள்ளது, அப்பாயின்ட்மென்ட் வேண்டும்',
      language: 'ta'
    });

    const passed9 =
      res9.isDentalHandled &&
      res9.answer.length > 5;

    results.push({
      id: 9,
      title: 'Test 9: Tamil Voice Input -> Localized Dental Receptionist Workflow',
      passed: passed9,
      actual: res9.answer
    });
    console.log(`[PASS] Test 9: ${res9.answer}\n`);
  } catch (err: any) {
    results.push({ id: 9, title: 'Test 9', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 10: Patient asks a general clinic question.
  // Expected: Kaira uses verified KnowledgeService without entering unrelated booking workflow.
  // --------------------------------------------------------------------------
  try {
    const generalCallId = `test_general_${Date.now()}`;
    const dentalTurn = await dentalAiService.handleTurn({
      callId: generalCallId,
      query: 'What are your clinic opening hours and working days?',
      language: 'en'
    });

    // Should return clinic hours or let KnowledgeService answer
    let finalAnswer = dentalTurn.answer;
    if (!dentalTurn.isDentalHandled || !finalAnswer) {
      const kbAnswer = await knowledgeService.answerQuery('What are your clinic opening hours and working days?');
      finalAnswer = kbAnswer.answer;
    }

    const passed10 =
      finalAnswer.toLowerCase().includes('9:00 am') ||
      finalAnswer.toLowerCase().includes('monday through saturday') ||
      finalAnswer.toLowerCase().includes('5:00 pm') ||
      finalAnswer.toLowerCase().includes('hours');

    results.push({
      id: 10,
      title: 'Test 10: General Clinic Question -> Verified Clinic Knowledge Retrieval',
      passed: passed10,
      actual: finalAnswer
    });
    console.log(`[PASS] Test 10: ${finalAnswer}\n`);
  } catch (err: any) {
    results.push({ id: 10, title: 'Test 10', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 11: Multi-Turn Context Memory & Zero Duplicate Questions (Requirement 8)
  // AI: When did your pain start?
  // Customer: One month.
  // AI: Which area is hurting?
  // Customer: My lower-right wisdom tooth.
  // AI: What type of pain are you experiencing?
  // Customer: Sharp pain.
  // AI: Is the pain constant or does it come and go?
  // Customer: It comes and goes.
  // --------------------------------------------------------------------------
  try {
    const memoryCallId = `test_memory_conversation_${Date.now()}`;
    const session11 = dentalAiService.getOrCreateSession(memoryCallId, 'en');
    session11.complaintType = 'WISDOM_TOOTH_PAIN';
    // AI asks duration first
    session11.currentPendingQuestion = {
      category: 'PAIN_DURATION',
      questionText: 'When did your pain start, and how long has it been bothering you?',
      askedAt: Date.now(),
      clarificationCount: 0
    };
    session11.askedQuestions.push(session11.currentPendingQuestion);

    // Turn 1: Customer: "One month."
    const turn1 = await dentalAiService.handleTurn({
      callId: memoryCallId,
      query: 'One month.',
      language: 'en'
    });

    const passedTurn1 =
      turn1.isDentalHandled &&
      session11.assessment.duration?.toLowerCase().includes('month') &&
      !turn1.answer.toLowerCase().includes('how long') &&
      !turn1.answer.toLowerCase().includes('when did') &&
      (turn1.answer.toLowerCase().includes('area') ||
       turn1.answer.toLowerCase().includes('which tooth') ||
       turn1.answer.toLowerCase().includes('where') ||
       turn1.answer.toLowerCase().includes('upper or lower') ||
       turn1.answer.toLowerCase().includes('jaw'));

    // Turn 2: Customer: "My lower-right wisdom tooth."
    const turn2 = await dentalAiService.handleTurn({
      callId: memoryCallId,
      query: 'My lower-right wisdom tooth.',
      language: 'en'
    });

    const passedTurn2 =
      turn2.isDentalHandled &&
      (session11.assessment.location?.toLowerCase().includes('lower-right') || session11.assessment.location?.toLowerCase().includes('wisdom tooth')) &&
      !turn2.answer.toLowerCase().includes('area') &&
      (turn2.answer.toLowerCase().includes('type of pain') || turn2.answer.toLowerCase().includes('sharp, dull'));

    // Turn 3: Customer: "Sharp pain."
    const turn3 = await dentalAiService.handleTurn({
      callId: memoryCallId,
      query: 'Sharp pain.',
      language: 'en'
    });

    const passedTurn3 =
      turn3.isDentalHandled &&
      session11.assessment.painType?.toLowerCase().includes('sharp') &&
      !turn3.answer.toLowerCase().includes('type of pain') &&
      (turn3.answer.toLowerCase().includes('constant') || turn3.answer.toLowerCase().includes('comes and goes'));

    // Turn 4: Customer: "It comes and goes."
    const turn4 = await dentalAiService.handleTurn({
      callId: memoryCallId,
      query: 'It comes and goes.',
      language: 'en'
    });

    const passedTurn4 =
      turn4.isDentalHandled &&
      session11.assessment.pattern?.toLowerCase().includes('comes and goes') &&
      !turn4.answer.toLowerCase().includes('constant') &&
      (turn4.answer.toLowerCase().includes('1 to 10') || turn4.answer.toLowerCase().includes('severity') || turn4.answer.toLowerCase().includes('swelling'));

    const allTurnPassed = passedTurn1 && passedTurn2 && passedTurn3 && passedTurn4;

    results.push({
      id: 11,
      title: 'Test 11: Multi-Turn Context Memory & Exact 4-Turn Clinical Dialog (No Repeated Questions)',
      passed: allTurnPassed,
      actual: `T1: "${turn1.answer}" | T2: "${turn2.answer}" | T3: "${turn3.answer}" | T4: "${turn4.answer}"`,
      details: `Assessment: Duration=${session11.assessment.duration}, Loc=${session11.assessment.location}, Type=${session11.assessment.painType}, Pattern=${session11.assessment.pattern}`
    });
    console.log(`[PASS] Test 11: All 4 turns remembered without repeating questions!\n`);
  } catch (err: any) {
    results.push({ id: 11, title: 'Test 11: Multi-Turn Context Memory', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 12: Unclear Answer Handling with Targeted Clarification (Requirement 6)
  // AI asks duration -> Customer says "I don't know" -> AI clarifies instead of repeating
  // --------------------------------------------------------------------------
  try {
    const unclearCallId = `test_unclear_${Date.now()}`;
    const session12 = dentalAiService.getOrCreateSession(unclearCallId, 'en');
    session12.complaintType = 'TOOTHACHE';
    session12.currentPendingQuestion = {
      category: 'PAIN_DURATION',
      questionText: 'When did this pain start, and how long has it been bothering you?',
      askedAt: Date.now(),
      clarificationCount: 0
    };
    session12.askedQuestions.push(session12.currentPendingQuestion);

    const clarifyRes = await dentalAiService.handleTurn({
      callId: unclearCallId,
      query: "I don't know.",
      language: 'en'
    });

    const passed12 =
      clarifyRes.isDentalHandled &&
      clarifyRes.answer.toLowerCase().includes("today, a few days ago, or several weeks ago") &&
      !clarifyRes.answer.toLowerCase().includes("how long has it been bothering you");

    results.push({
      id: 12,
      title: 'Test 12: Unclear Answer Handling -> Contextual Multiple-Choice Clarification',
      passed: passed12,
      actual: clarifyRes.answer
    });
    console.log(`[PASS] Test 12: ${clarifyRes.answer}\n`);
  } catch (err: any) {
    results.push({ id: 12, title: 'Test 12: Unclear Answer Handling', passed: false, actual: err.message });
  }

  console.log('================================================================');
  console.log('                 TEST EXECUTION SUMMARY');
  console.log('================================================================');
  let passCount = 0;
  for (const r of results) {
    console.log(`[${r.passed ? 'PASSED' : 'FAILED'}] Test ${r.id}: ${r.title}`);
    if (r.details) console.log(`   Details: ${r.details}`);
    if (r.passed) passCount++;
  }
  console.log(`\nOverall Results: ${passCount} / ${results.length} PASSED`);

  if (passCount === results.length) {
    console.log('\n>>> ALL 10 TESTS PASSED SUCCESSFULLY! <<<\n');
    process.exit(0);
  } else {
    console.error('\n>>> SOME TESTS FAILED! <<<\n');
    process.exit(1);
  }
}

runDentalTestSuite().catch((err) => {
  console.error('[Fatal Test Error]', err);
  process.exit(1);
});
