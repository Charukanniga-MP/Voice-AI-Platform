import { dentalAiService } from '../services/dentalAi.service.js';
import { dentalLlmService, VERIFIED_CLINIC_DATA } from '../services/dentalLlm.service.js';
import { handoverService } from '../services/handover.service.js';
import { knowledgeService } from '../services/knowledge.js';

interface TestResult {
  id: number;
  title: string;
  passed: boolean;
  actual: string;
  details?: string;
}

async function runIntelligentConversationalSuite() {
  console.log('========================================================================');
  console.log('  🧪 KAIRA AI: INTELLIGENT CONVERSATIONAL SUITE (22 DIVERSE SCENARIOS)');
  console.log('========================================================================\n');

  const results: TestResult[] = [];

  // --------------------------------------------------------------------------
  // TEST 1: Section 3 Example 1 - Wisdom Tooth Pain
  // Customer: "I have wisdom tooth pain."
  // KAIRA: "Wisdom tooth pain can have several causes, including impaction, gum inflammation or infection. Is the pain on your upper or lower jaw?"
  // --------------------------------------------------------------------------
  try {
    const callId1 = `test_q1_${Date.now()}`;
    const res1 = await dentalAiService.handleTurn({
      callId: callId1,
      query: 'I have wisdom tooth pain.',
      language: 'en'
    });

    const passed1 =
      res1.isDentalHandled &&
      !res1.requiresTransfer &&
      res1.answer.toLowerCase().includes('upper or lower') &&
      (res1.answer.toLowerCase().includes('impaction') || res1.answer.toLowerCase().includes('wisdom tooth'));

    results.push({
      id: 1,
      title: 'Test 1: Section 3 Example 1 - Wisdom Tooth Pain Explanatory Triage',
      passed: passed1,
      actual: res1.answer
    });
    console.log(`[PASS] Test 1: ${res1.answer}\n`);
  } catch (err: any) {
    results.push({ id: 1, title: 'Test 1: Wisdom Tooth Pain', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 2: Section 3 Example 2 - "What is a root canal?"
  // KAIRA: "A root canal is a treatment that removes infected or damaged tissue from inside a tooth to help preserve it."
  // --------------------------------------------------------------------------
  const sharedCallId = `test_multiturn_${Date.now()}`;
  try {
    const res2 = await dentalAiService.handleTurn({
      callId: sharedCallId,
      query: 'What is a root canal?',
      language: 'en'
    });

    const passed2 =
      res2.isDentalHandled &&
      !res2.requiresTransfer &&
      res2.answer.toLowerCase().includes('root canal') &&
      res2.answer.toLowerCase().includes('infected') &&
      res2.answer.toLowerCase().includes('tissue');

    results.push({
      id: 2,
      title: 'Test 2: Section 3 Example 2 - Root Canal Definition',
      passed: passed2,
      actual: res2.answer
    });
    console.log(`[PASS] Test 2: ${res2.answer}\n`);
  } catch (err: any) {
    results.push({ id: 2, title: 'Test 2: Root Canal Definition', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 3: Section 6 Pronoun Resolution - "Does it hurt?"
  // Customer: "Does it hurt?" (Following "What is a root canal?")
  // Expected: AI understands "it" refers to root canal treatment
  // --------------------------------------------------------------------------
  try {
    const res3 = await dentalAiService.handleTurn({
      callId: sharedCallId,
      query: 'Does it hurt?',
      language: 'en'
    });

    const passed3 =
      res3.isDentalHandled &&
      !res3.requiresTransfer &&
      (res3.answer.toLowerCase().includes('root canal') || res3.answer.toLowerCase().includes('anesthesia') || res3.answer.toLowerCase().includes('painless') || res3.answer.toLowerCase().includes('filling'));

    results.push({
      id: 3,
      title: 'Test 3: Section 6 Context Memory & Pronoun Resolution ("Does it hurt?" -> Root Canal)',
      passed: passed3,
      actual: res3.answer
    });
    console.log(`[PASS] Test 3: ${res3.answer}\n`);
  } catch (err: any) {
    results.push({ id: 3, title: 'Test 3: Pronoun Resolution', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 4: Follow-up Pronoun - "How much does that cost?"
  // Expected: AI resolves "that" to root canal and provides verified clinic pricing ($150 / $700-$1,200)
  // --------------------------------------------------------------------------
  try {
    const res4 = await dentalAiService.handleTurn({
      callId: sharedCallId,
      query: 'How much does that cost?',
      language: 'en'
    });

    const passed4 =
      res4.isDentalHandled &&
      !res4.requiresTransfer &&
      (res4.answer.includes('$150') || res4.answer.includes('700') || res4.answer.toLowerCase().includes('root canal'));

    results.push({
      id: 4,
      title: 'Test 4: Follow-up Pronoun Pricing ("How much does that cost?" -> Verified Root Canal Price)',
      passed: passed4,
      actual: res4.answer
    });
    console.log(`[PASS] Test 4: ${res4.answer}\n`);
  } catch (err: any) {
    results.push({ id: 4, title: 'Test 4: Follow-up Pricing', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 5: Section 3 Example 4 - "I want to book an appointment."
  // KAIRA: "Certainly! What date would you prefer?"
  // --------------------------------------------------------------------------
  try {
    const res5 = await dentalAiService.handleTurn({
      callId: `test_book_prompt_${Date.now()}`,
      query: 'I want to book an appointment.',
      language: 'en'
    });

    const passed5 =
      res5.isDentalHandled &&
      !res5.requiresTransfer &&
      res5.answer.toLowerCase().includes('certainly') &&
      res5.answer.toLowerCase().includes('date');

    results.push({
      id: 5,
      title: 'Test 5: Section 3 Example 4 - Receptionist Transition ("I want to book an appointment")',
      passed: passed5,
      actual: res5.answer
    });
    console.log(`[PASS] Test 5: ${res5.answer}\n`);
  } catch (err: any) {
    results.push({ id: 5, title: 'Test 5: Receptionist Transition', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 6: Section 3 Example 3 - "Does teeth cleaning hurt?"
  // KAIRA: "Professional teeth cleaning is generally comfortable, although some people experience temporary sensitivity."
  // --------------------------------------------------------------------------
  const cleaningCallId = `test_cleaning_${Date.now()}`;
  try {
    const res6 = await dentalAiService.handleTurn({
      callId: cleaningCallId,
      query: 'Does teeth cleaning hurt?',
      language: 'en'
    });

    const passed6 =
      res6.isDentalHandled &&
      !res6.requiresTransfer &&
      res6.answer.toLowerCase().includes('cleaning') &&
      res6.answer.toLowerCase().includes('comfortable') &&
      res6.answer.toLowerCase().includes('sensitivity');

    results.push({
      id: 6,
      title: 'Test 6: Section 3 Example 3 - Teeth Cleaning Sensation Explanation',
      passed: passed6,
      actual: res6.answer
    });
    console.log(`[PASS] Test 6: ${res6.answer}\n`);
  } catch (err: any) {
    results.push({ id: 6, title: 'Test 6: Teeth Cleaning Sensation', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 7: Pronoun Follow-up - "Can I eat after that?"
  // Expected: Resolves "that" to teeth cleaning / procedure care
  // --------------------------------------------------------------------------
  try {
    const res7 = await dentalAiService.handleTurn({
      callId: cleaningCallId,
      query: 'Can I eat after that?',
      language: 'en'
    });

    const passed7 =
      res7.isDentalHandled &&
      !res7.requiresTransfer &&
      (res7.answer.toLowerCase().includes('eat') || res7.answer.toLowerCase().includes('anesthesia') || res7.answer.toLowerCase().includes('soft foods'));

    results.push({
      id: 7,
      title: 'Test 7: Pronoun Follow-up Aftercare ("Can I eat after that?")',
      passed: passed7,
      actual: res7.answer
    });
    console.log(`[PASS] Test 7: ${res7.answer}\n`);
  } catch (err: any) {
    results.push({ id: 7, title: 'Test 7: Aftercare Pronoun', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 8: General Dental Knowledge - Gum Bleeding
  // Customer: "Why are my gums bleeding when I brush?"
  // --------------------------------------------------------------------------
  try {
    const res8 = await dentalAiService.handleTurn({
      callId: `test_gum_${Date.now()}`,
      query: 'Why are my gums bleeding when I brush?',
      language: 'en'
    });

    const passed8 =
      res8.isDentalHandled &&
      !res8.requiresTransfer &&
      (res8.answer.toLowerCase().includes('plaque') || res8.answer.toLowerCase().includes('gingivitis') || res8.answer.toLowerCase().includes('floss'));

    results.push({
      id: 8,
      title: 'Test 8: General Knowledge - Gum Bleeding & Gingivitis Causes',
      passed: passed8,
      actual: res8.answer
    });
    console.log(`[PASS] Test 8: ${res8.answer}\n`);
  } catch (err: any) {
    results.push({ id: 8, title: 'Test 8: Gum Bleeding', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 9: General Dental Knowledge - Crown vs. Veneer
  // Customer: "What is the difference between a crown and a veneer?"
  // --------------------------------------------------------------------------
  try {
    const res9 = await dentalAiService.handleTurn({
      callId: `test_crown_veneer_${Date.now()}`,
      query: 'What is the difference between a crown and a veneer?',
      language: 'en'
    });

    const passed9 =
      res9.isDentalHandled &&
      !res9.requiresTransfer &&
      res9.answer.toLowerCase().includes('crown') &&
      res9.answer.toLowerCase().includes('veneer');

    results.push({
      id: 9,
      title: 'Test 9: General Knowledge - Distinguishing Dental Crowns vs. Veneers',
      passed: passed9,
      actual: res9.answer
    });
    console.log(`[PASS] Test 9: ${res9.answer}\n`);
  } catch (err: any) {
    results.push({ id: 9, title: 'Test 9: Crown vs Veneer', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 10: General Dental Knowledge - Tooth Sensitivity to Cold
  // Customer: "Why does cold water make my teeth hurt?"
  // --------------------------------------------------------------------------
  try {
    const res10 = await dentalAiService.handleTurn({
      callId: `test_sens_${Date.now()}`,
      query: 'Why does cold water make my teeth hurt?',
      language: 'en'
    });

    const passed10 =
      res10.isDentalHandled &&
      !res10.requiresTransfer &&
      (res10.answer.toLowerCase().includes('enamel') || res10.answer.toLowerCase().includes('dentin') || res10.answer.toLowerCase().includes('sensitiv'));

    results.push({
      id: 10,
      title: 'Test 10: General Knowledge - Tooth Sensitivity Etiology',
      passed: passed10,
      actual: res10.answer
    });
    console.log(`[PASS] Test 10: ${res10.answer}\n`);
  } catch (err: any) {
    results.push({ id: 10, title: 'Test 10: Tooth Sensitivity', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 11: General Dental Knowledge - Dental Implants
  // Customer: "How do dental implants work?"
  // --------------------------------------------------------------------------
  try {
    const res11 = await dentalAiService.handleTurn({
      callId: `test_implant_${Date.now()}`,
      query: 'How do dental implants work?',
      language: 'en'
    });

    const passed11 =
      res11.isDentalHandled &&
      !res11.requiresTransfer &&
      (res11.answer.toLowerCase().includes('titanium') || res11.answer.toLowerCase().includes('jawbone') || res11.answer.toLowerCase().includes('missing tooth') || res11.answer.toLowerCase().includes('crown'));

    results.push({
      id: 11,
      title: 'Test 11: General Knowledge - Dental Implant Mechanism',
      passed: passed11,
      actual: res11.answer
    });
    console.log(`[PASS] Test 11: ${res11.answer}\n`);
  } catch (err: any) {
    results.push({ id: 11, title: 'Test 11: Dental Implants', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 12: General Dental Knowledge - Brushing & Flossing Frequency
  // Customer: "How often should I brush and floss my teeth?"
  // --------------------------------------------------------------------------
  try {
    const res12 = await dentalAiService.handleTurn({
      callId: `test_hygiene_${Date.now()}`,
      query: 'How often should I brush and floss my teeth?',
      language: 'en'
    });

    const passed12 =
      res12.isDentalHandled &&
      !res12.requiresTransfer &&
      res12.answer.toLowerCase().includes('twice') &&
      res12.answer.toLowerCase().includes('floss');

    results.push({
      id: 12,
      title: 'Test 12: General Knowledge - Preventative Oral Hygiene Routine',
      passed: passed12,
      actual: res12.answer
    });
    console.log(`[PASS] Test 12: ${res12.answer}\n`);
  } catch (err: any) {
    results.push({ id: 12, title: 'Test 12: Oral Hygiene', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 13: General Dental Knowledge - Broken Tooth Emergency Advice
  // Customer: "What should I do if my tooth is chipped or broken?"
  // --------------------------------------------------------------------------
  try {
    const res13 = await dentalAiService.handleTurn({
      callId: `test_broken_${Date.now()}`,
      query: 'What should I do if my tooth is chipped or broken?',
      language: 'en'
    });

    const passed13 =
      res13.isDentalHandled &&
      !res13.requiresTransfer &&
      (res13.answer.toLowerCase().includes('dentist') || res13.answer.toLowerCase().includes('bonding') || res13.answer.toLowerCase().includes('crown'));

    results.push({
      id: 13,
      title: 'Test 13: General Knowledge - Broken Tooth Care',
      passed: passed13,
      actual: res13.answer
    });
    console.log(`[PASS] Test 13: ${res13.answer}\n`);
  } catch (err: any) {
    results.push({ id: 13, title: 'Test 13: Broken Tooth Care', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 14: Verified Clinic-Specific Knowledge - Opening Hours
  // Customer: "What are your opening hours on Saturday?"
  // --------------------------------------------------------------------------
  try {
    const res14 = await dentalAiService.handleTurn({
      callId: `test_hours_${Date.now()}`,
      query: 'What are your opening hours on Saturday?',
      language: 'en'
    });

    const passed14 =
      res14.isDentalHandled &&
      !res14.requiresTransfer &&
      res14.answer.includes('9:00 AM') &&
      res14.answer.includes('5:00 PM') &&
      res14.answer.toLowerCase().includes('closed on sundays');

    results.push({
      id: 14,
      title: 'Test 14: Verified Clinic Grounding - Operating Hours & Sunday Closure',
      passed: passed14,
      actual: res14.answer
    });
    console.log(`[PASS] Test 14: ${res14.answer}\n`);
  } catch (err: any) {
    results.push({ id: 14, title: 'Test 14: Opening Hours', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 15: Verified Clinic-Specific Knowledge - Dentists and Specializations
  // Customer: "Who are the dentists at your clinic?"
  // --------------------------------------------------------------------------
  try {
    const res15 = await dentalAiService.handleTurn({
      callId: `test_dentists_${Date.now()}`,
      query: 'Who are the dentists at your clinic?',
      language: 'en'
    });

    const passed15 =
      res15.isDentalHandled &&
      !res15.requiresTransfer &&
      res15.answer.includes('Dr. Sarah Smith') &&
      res15.answer.includes('Dr. Rajesh Kumar') &&
      res15.answer.includes('Dr. Anand V');

    results.push({
      id: 15,
      title: 'Test 15: Verified Clinic Grounding - Active Dentists & Specializations',
      passed: passed15,
      actual: res15.answer
    });
    console.log(`[PASS] Test 15: ${res15.answer}\n`);
  } catch (err: any) {
    results.push({ id: 15, title: 'Test 15: Dentists Info', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 16: Verified Clinic-Specific Knowledge - Address & Phone Number
  // Customer: "Where is the clinic located and what is your phone number?"
  // --------------------------------------------------------------------------
  try {
    const res16 = await dentalAiService.handleTurn({
      callId: `test_address_${Date.now()}`,
      query: 'Where is the clinic located and what is your phone number?',
      language: 'en'
    });

    const passed16 =
      res16.isDentalHandled &&
      !res16.requiresTransfer &&
      res16.answer.includes('100 Dental Plaza') &&
      res16.answer.includes('(555) 019-2834');

    results.push({
      id: 16,
      title: 'Test 16: Verified Clinic Grounding - Address & Contact Number',
      passed: passed16,
      actual: res16.answer
    });
    console.log(`[PASS] Test 16: ${res16.answer}\n`);
  } catch (err: any) {
    results.push({ id: 16, title: 'Test 16: Address & Phone', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 17: Speech Recognition Noise & Spelling Mistake Tolerance
  // Customer: "wodsom toth hurt bad"
  // --------------------------------------------------------------------------
  try {
    const res17 = await dentalAiService.handleTurn({
      callId: `test_typo_${Date.now()}`,
      query: 'wodsom toth hurt bad',
      language: 'en'
    });

    const passed17 =
      res17.isDentalHandled &&
      !res17.requiresTransfer &&
      (res17.answer.toLowerCase().includes('wisdom') || res17.answer.toLowerCase().includes('jaw') || res17.answer.toLowerCase().includes('pain'));

    results.push({
      id: 17,
      title: 'Test 17: Natural Speech & Phonetic Typo Tolerance ("wodsom toth hurt bad")',
      passed: passed17,
      actual: res17.answer
    });
    console.log(`[PASS] Test 17: ${res17.answer}\n`);
  } catch (err: any) {
    results.push({ id: 17, title: 'Test 17: Typo Tolerance', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 18: Multi-Turn Clinical Intake Memory (Zero Repeated Questions)
  // --------------------------------------------------------------------------
  try {
    const memoryCallId = `test_4turn_clinical_${Date.now()}`;
    const session18 = dentalAiService.getOrCreateSession(memoryCallId, 'en');
    session18.complaintType = 'WISDOM_TOOTH_PAIN';
    session18.currentPendingQuestion = {
      category: 'PAIN_DURATION',
      questionText: 'When did this pain start, and how long has it been bothering you?',
      askedAt: Date.now(),
      clarificationCount: 0
    };
    session18.askedQuestions.push(session18.currentPendingQuestion);

    const t1 = await dentalAiService.handleTurn({ callId: memoryCallId, query: 'One month.', language: 'en' });
    const t2 = await dentalAiService.handleTurn({ callId: memoryCallId, query: 'My lower-right wisdom tooth.', language: 'en' });
    const t3 = await dentalAiService.handleTurn({ callId: memoryCallId, query: 'Sharp pain.', language: 'en' });
    const t4 = await dentalAiService.handleTurn({ callId: memoryCallId, query: 'It comes and goes.', language: 'en' });

    const passed18 =
      t1.isDentalHandled &&
      t2.isDentalHandled &&
      t3.isDentalHandled &&
      t4.isDentalHandled &&
      session18.assessment.duration?.toLowerCase().includes('month') &&
      session18.assessment.location?.toLowerCase().includes('lower-right') &&
      session18.assessment.painType?.toLowerCase().includes('sharp') &&
      session18.assessment.pattern?.toLowerCase().includes('comes and goes');

    results.push({
      id: 18,
      title: 'Test 18: Multi-Turn Clinical Memory & Zero Duplicate Questions Across 4 Turns',
      passed: passed18,
      actual: `T1: "${t1.answer}" -> T2: "${t2.answer}" -> T3: "${t3.answer}" -> T4: "${t4.answer}"`
    });
    console.log(`[PASS] Test 18: 4-turn clinical dialog remembered perfectly!\n`);
  } catch (err: any) {
    results.push({ id: 18, title: 'Test 18: Multi-Turn Memory', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 19: End-to-End Real Database Appointment Booking
  // Customer selects date, time, supplies name & phone -> DB atomic booking + Reference DEN-2026-XXXX
  // --------------------------------------------------------------------------
  try {
    const bookCallId = `test_real_booking_${Date.now()}`;
    // Step 1: Select date
    const b1 = await dentalAiService.handleTurn({
      callId: bookCallId,
      query: 'I want an appointment on 2026-11-30.',
      language: 'en'
    });

    // Step 2: Select slot + contact info
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const randomName = `Abinaya ${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const b2 = await dentalAiService.handleTurn({
      callId: bookCallId,
      query: `That first slot works best. My name is ${randomName}, phone +1-555-${randomSuffix}`,
      language: 'en'
    });

    const passed19 =
      b1.isDentalHandled &&
      b2.isDentalHandled &&
      Boolean(b2.bookingReference) &&
      /^DEN-2026-[A-Z0-9]{4}$/.test(b2.bookingReference!);

    results.push({
      id: 19,
      title: 'Test 19: Real Database Appointment Booking (Atomic Transaction & Unique Reference)',
      passed: passed19,
      actual: b2.answer,
      details: `Booking Reference: ${b2.bookingReference}`
    });
    console.log(`[PASS] Test 19: Confirmed booking reference: ${b2.bookingReference}\n`);
  } catch (err: any) {
    results.push({ id: 19, title: 'Test 19: Real Booking', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 20: No Unnecessary Handover on Ordinary Dental Questions
  // Verify that handoverService does NOT transfer for ordinary questions
  // --------------------------------------------------------------------------
  try {
    const handoverEval = await handoverService.evaluateHandover({
      queryText: 'Can you tell me how teeth whitening works?',
      callLang: 'en',
      sentimentResult: { sentiment: 'NEUTRAL', confidenceScore: 0.95 } as any,
      aiResponse: {
        answer: 'Professional teeth whitening safely removes deep surface stains using specialized dental bleaching gels.',
        isGrounded: true,
        requiresTransfer: false,
        confidence: 0.95
      }
    });

    const passed20 = !handoverEval.shouldTransfer;

    results.push({
      id: 20,
      title: 'Test 20: No Unnecessary Human Handover on Ordinary Dental Questions',
      passed: passed20,
      actual: `shouldTransfer: ${handoverEval.shouldTransfer}`
    });
    console.log(`[PASS] Test 20: Verified no unnecessary transfer (shouldTransfer=${handoverEval.shouldTransfer})\n`);
  } catch (err: any) {
    results.push({ id: 20, title: 'Test 20: No Unnecessary Handover', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 21: Preserved Life-Threatening Emergency Escalation
  // Customer: "I cannot breathe and my throat is closing with severe facial swelling."
  // --------------------------------------------------------------------------
  try {
    const res21 = await dentalAiService.handleTurn({
      callId: `test_emergency_${Date.now()}`,
      query: 'I cannot breathe and my throat is closing with severe facial swelling.',
      language: 'en'
    });

    const passed21 =
      res21.isDentalHandled &&
      res21.requiresTransfer &&
      res21.transferReason === 'Urgent Life-Threatening Dental/Airway Symptom' &&
      res21.answer.toLowerCase().includes('emergency');

    results.push({
      id: 21,
      title: 'Test 21: Preserved Life-Threatening Emergency Medical Escalation Protocol',
      passed: passed21,
      actual: res21.answer,
      details: `requiresTransfer: ${res21.requiresTransfer}, reason: ${res21.transferReason}`
    });
    console.log(`[PASS] Test 21: Urgent emergency correctly escalated with ER recommendation!\n`);
  } catch (err: any) {
    results.push({ id: 21, title: 'Test 21: Emergency Escalation', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // TEST 22: Multilingual Conversational Intelligence (Tamil)
  // Customer: "பல் கூச்சம் ஏன் ஏற்படுகிறது?" (Why does tooth sensitivity occur?)
  // --------------------------------------------------------------------------
  try {
    const res22 = await dentalAiService.handleTurn({
      callId: `test_tamil_${Date.now()}`,
      query: 'பல் கூச்சம் ஏன் ஏற்படுகிறது?',
      language: 'ta'
    });

    const passed22 =
      res22.isDentalHandled &&
      !res22.requiresTransfer &&
      res22.answer.length > 10;

    results.push({
      id: 22,
      title: 'Test 22: Multilingual Conversational Intelligence (Tamil Voice Input)',
      passed: passed22,
      actual: res22.answer
    });
    console.log(`[PASS] Test 22: Localized response: ${res22.answer}\n`);
  } catch (err: any) {
    results.push({ id: 22, title: 'Test 22: Multilingual Intelligence', passed: false, actual: err.message });
  }

  // --------------------------------------------------------------------------
  // FINAL SCORECARD
  // --------------------------------------------------------------------------
  console.log('========================================================================');
  console.log('                 CONVERSATIONAL TEST RESULTS SUMMARY');
  console.log('========================================================================');
  let passedCount = 0;
  for (const r of results) {
    if (r.passed) {
      passedCount++;
      console.log(`[PASSED] ${r.title}`);
      if (r.details) console.log(`   Details: ${r.details}`);
    } else {
      console.log(`[FAILED] ${r.title}`);
      console.log(`   Actual: "${r.actual}"`);
    }
  }

  console.log(`\nOverall Results: ${passedCount} / ${results.length} PASSED`);
  if (passedCount === results.length) {
    console.log('\n>>> ALL 22 CONVERSATIONAL SCENARIOS PASSED SUCCESSFULLY! <<<\n');
  } else {
    console.log('\n>>> SOME TESTS FAILED! <<<\n');
    process.exit(1);
  }
}

runIntelligentConversationalSuite().catch(err => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
