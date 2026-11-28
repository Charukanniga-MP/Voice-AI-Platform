import { prisma } from '../db.js';

export async function seedDentalData() {
  console.log('[Seed] Seeding realistic dental clinic data...');

  // 1. Seed Dentists
  const dentistsData = [
    {
      name: 'Dr. Sarah Smith',
      email: 'sarah.smith@kairadental.com',
      phone: '+1-555-0191',
      specialization: 'General Dentistry',
      licenseNumber: 'DEN-LIC-88210',
      consultationFee: 75.0,
      bio: 'Experienced dental practitioner specializing in preventive care, cleanings, and routine restorations.',
      isActive: true
    },
    {
      name: 'Dr. Rajesh Kumar',
      email: 'rajesh.kumar@kairadental.com',
      phone: '+1-555-0192',
      specialization: 'Endodontics & Oral Surgery',
      licenseNumber: 'DEN-LIC-99321',
      consultationFee: 110.0,
      bio: 'Specialist in wisdom tooth assessment, surgical extractions, root canal therapy, and severe toothache triage.',
      isActive: true
    },
    {
      name: 'Dr. Anand V',
      email: 'anand.v@kairadental.com',
      phone: '+1-555-0193',
      specialization: 'Periodontics & Implantology',
      licenseNumber: 'DEN-LIC-77432',
      consultationFee: 95.0,
      bio: 'Specialist in periodontal health, gum bleeding/swelling, dental implants, and bone restoration.',
      isActive: true
    }
  ];

  const dentists: Record<string, any> = {};
  for (const d of dentistsData) {
    const dentist = await prisma.dentist.upsert({
      where: { email: d.email },
      update: d,
      create: d
    });
    dentists[dentist.specialization] = dentist;
    console.log(`[Seed] Dentist ready: ${dentist.name} (${dentist.specialization})`);
  }

  // 2. Seed Dental Services
  const servicesData = [
    {
      code: 'WISDOM_EXAM',
      name: 'Wisdom Tooth Assessment & Extraction Consultation',
      category: 'surgical',
      description: 'Comprehensive clinical evaluation and X-ray review for wisdom tooth pain, impaction, or extraction planning.',
      durationMinutes: 30,
      price: 120.0,
      isActive: true
    },
    {
      code: 'TOOTHACHE_EXAM',
      name: 'Emergency Toothache Exam & Diagnosis',
      category: 'emergency',
      description: 'Urgent assessment for acute dental pain, throbbing sensitivity, or suspected deep decay.',
      durationMinutes: 30,
      price: 90.0,
      isActive: true
    },
    {
      code: 'CLEANING',
      name: 'Routine Dental Cleaning & Oral Hygiene',
      category: 'preventive',
      description: 'Professional plaque/tartar removal, polish, and full dental checkup.',
      durationMinutes: 30,
      price: 80.0,
      isActive: true
    },
    {
      code: 'ROOT_CANAL',
      name: 'Root Canal Therapy Consultation',
      category: 'restorative',
      description: 'Endodontic diagnosis and nerve relief procedure evaluation for infected pulp.',
      durationMinutes: 45,
      price: 150.0,
      isActive: true
    },
    {
      code: 'GUM_EVAL',
      name: 'Periodontal & Gum Bleeding Evaluation',
      category: 'preventive',
      description: 'Assessment of gingival health, bleeding gums, pocket depths, and deep scaling plan.',
      durationMinutes: 30,
      price: 95.0,
      isActive: true
    },
    {
      code: 'BROKEN_TOOTH_EXAM',
      name: 'Broken Tooth & Dental Trauma Consultation',
      category: 'restorative',
      description: 'Evaluation of chipped, cracked, or fractured teeth for bonding, crown, or emergency repair.',
      durationMinutes: 30,
      price: 100.0,
      isActive: true
    },
    {
      code: 'IMPLANT_CONSULT',
      name: 'Dental Implant & Missing Tooth Consultation',
      category: 'restorative',
      description: 'Consultation for replacing missing teeth with titanium dental implants or fixed bridges.',
      durationMinutes: 30,
      price: 110.0,
      isActive: true
    },
    {
      code: 'WHITENING',
      name: 'Professional Teeth Whitening',
      category: 'cosmetic',
      description: 'In-office gentle laser or tray whitening to remove deep enamel stains.',
      durationMinutes: 45,
      price: 200.0,
      isActive: true
    }
  ];

  for (const s of servicesData) {
    await prisma.dentalService.upsert({
      where: { code: s.code },
      update: s,
      create: s
    });
    console.log(`[Seed] Service ready: ${s.name} (${s.code})`);
  }

  // 3. Seed Schedules (Monday = 1 through Saturday = 6, 09:00 - 17:00)
  const allDentists = await prisma.dentist.findMany();
  for (const dentist of allDentists) {
    for (let day = 1; day <= 6; day++) {
      await prisma.dentistSchedule.upsert({
        where: {
          dentistId_dayOfWeek: {
            dentistId: dentist.id,
            dayOfWeek: day
          }
        },
        update: {
          startTime: '09:00',
          endTime: '17:00',
          slotDurationMinutes: 30,
          isWorkingDay: true
        },
        create: {
          dentistId: dentist.id,
          dayOfWeek: day,
          startTime: '09:00',
          endTime: '17:00',
          slotDurationMinutes: 30,
          isWorkingDay: true
        }
      });
    }

    // Sunday = 0 (closed)
    await prisma.dentistSchedule.upsert({
      where: {
        dentistId_dayOfWeek: {
          dentistId: dentist.id,
          dayOfWeek: 0
        }
      },
      update: {
        startTime: '00:00',
        endTime: '00:00',
        slotDurationMinutes: 30,
        isWorkingDay: false
      },
      create: {
        dentistId: dentist.id,
        dayOfWeek: 0,
        startTime: '00:00',
        endTime: '00:00',
        slotDurationMinutes: 30,
        isWorkingDay: false
      }
    });
  }
  console.log(`[Seed] Schedules initialized for ${allDentists.length} dentists (Mon-Sat 09:00-17:00).`);

  // 4. Seed Clinic Knowledge Document for General Questions
  const clinicDoc = await prisma.knowledgeDocument.upsert({
    where: { id: 'kaira-dental-clinic-guide' },
    update: {
      title: 'KAIRA Dental Clinic General Information Guide',
      status: 'active'
    },
    create: {
      id: 'kaira-dental-clinic-guide',
      title: 'KAIRA Dental Clinic General Information Guide',
      fileName: 'kaira_dental_clinic_guide.pdf',
      fileSize: 1024,
      fileType: 'application/pdf',
      status: 'active',
      extractedText: 'KAIRA Dental Clinic General Information Guide: hours, dentists, emergency protocol, insurance, location.'
    }
  });

  const clinicFaqs = [
    {
      id: 'faq-dental-hours',
      title: 'Clinic Opening Hours and Working Days',
      content: 'KAIRA Dental Clinic is open Monday through Saturday from 9:00 AM to 5:00 PM. We are closed on Sundays.',
      category: 'clinic_hours'
    },
    {
      id: 'faq-dental-emergency',
      title: 'Dental Emergency Protocol',
      content: 'For life-threatening emergencies involving difficulty breathing, difficulty swallowing, or severe uncontrolled bleeding, immediately proceed to the nearest hospital emergency room or dial emergency services (911/112). For acute dental pain during clinic hours, we offer same-day emergency appointments.',
      category: 'emergency'
    },
    {
      id: 'faq-dental-dentists',
      title: 'Dentists and Specializations at KAIRA Dental Clinic',
      content: 'Our clinical team includes Dr. Sarah Smith (General Dentistry & Preventative Care), Dr. Rajesh Kumar (Endodontics & Oral Surgery, specializing in wisdom teeth and root canals), and Dr. Anand V (Periodontics & Implantology, specializing in gum disease and dental implants).',
      category: 'dentists'
    },
    {
      id: 'faq-dental-insurance',
      title: 'Accepted Dental Insurance and Payment Options',
      content: 'We accept major dental insurance networks including Delta Dental, Cigna, MetLife, Aetna, and Guardian. Flexible self-pay payment plans and major credit cards are also accepted.',
      category: 'insurance'
    },
    {
      id: 'faq-dental-location',
      title: 'Clinic Location and Parking',
      content: 'KAIRA Dental Clinic is conveniently located at 123 Healthcare Boulevard, Suite 400. Free patient parking is available on-site.',
      category: 'location'
    }
  ];

  for (const faq of clinicFaqs) {
    await prisma.knowledgeEntry.upsert({
      where: { id: faq.id },
      update: {
        title: faq.title,
        content: faq.content,
        category: faq.category,
        documentId: clinicDoc.id
      },
      create: {
        id: faq.id,
        title: faq.title,
        content: faq.content,
        category: faq.category,
        documentId: clinicDoc.id,
        pageNumber: 1
      }
    });
  }

  console.log('[Seed] Dental clinic data seed completed successfully!');
}

if (process.argv[1]?.endsWith('seed_dental_data.ts') || process.argv[1]?.endsWith('seed_dental_data.js')) {
  seedDentalData()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Seed Error]', err);
      process.exit(1);
    });
}
