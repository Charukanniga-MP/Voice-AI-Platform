import { prisma } from '../db.js';

export interface AvailableSlot {
  dentistId: string;
  dentistName: string;
  specialization: string;
  serviceId?: string;
  serviceName?: string;
  dateStr: string; // YYYY-MM-DD
  timeStr: string; // HH:mm (e.g. "09:30")
  displayTime: string; // e.g. "9:30 AM"
  startDateTime: Date;
  endDateTime: Date;
}

export interface BookAppointmentInput {
  patientName: string;
  patientPhone: string;
  patientEmail?: string;
  dentistId: string;
  serviceId: string;
  appointmentDateTime: Date;
  chiefComplaint?: string;
  callRecordId?: string;
  actorType?: 'patient' | 'ai_voice' | 'staff' | 'system';
  actorId?: string;
}

export class DentalAppointmentService {
  /**
   * Generates a collision-resistant unique booking reference: DEN-YYYY-XXXX
   */
  public generateBookingReference(): string {
    const year = new Date().getFullYear();
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let rand = '';
    for (let i = 0; i < 4; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `DEN-${year}-${rand}`;
  }

  /**
   * Helper to format 24-hour time "09:30" into display "9:30 AM"
   */
  public formatDisplayTime(timeStr: string): string {
    const [hoursStr, minsStr] = timeStr.split(':');
    let hours = parseInt(hoursStr, 10);
    const mins = minsStr || '00';
    const period = hours >= 12 ? 'PM' : 'AM';
    if (hours === 0) hours = 12;
    else if (hours > 12) hours -= 12;
    return `${hours}:${mins} ${period}`;
  }

  /**
   * Get or create patient by phone number
   */
  public async getOrCreatePatient(
    name: string,
    phone: string,
    email?: string,
    userId?: string
  ) {
    const cleanedPhone = phone.replace(/[^\d+]/g, '');
    if (!cleanedPhone || cleanedPhone.length < 7) {
      throw new Error('Valid patient phone number is required (at least 7 digits)');
    }
    if (!name || name.trim().length < 2) {
      throw new Error('Valid patient name is required');
    }

    let patient = await prisma.patient.findUnique({
      where: { phone: cleanedPhone }
    });

    if (patient) {
      // Update name if changed
      if (name && patient.name !== name.trim()) {
        patient = await prisma.patient.update({
          where: { id: patient.id },
          data: {
            name: name.trim(),
            ...(email ? { email: email.trim().toLowerCase() } : {}),
            ...(userId ? { userId } : {})
          }
        });
      }
      return patient;
    }

    return await prisma.patient.create({
      data: {
        name: name.trim(),
        phone: cleanedPhone,
        email: email ? email.trim().toLowerCase() : null,
        userId: userId || null
      }
    });
  }

  /**
   * Retrieve active dentists
   */
  public async getDentists(specialization?: string) {
    return await prisma.dentist.findMany({
      where: {
        isActive: true,
        ...(specialization ? { specialization: { contains: specialization } } : {})
      },
      include: {
        schedules: true
      }
    });
  }

  /**
   * Retrieve active dental services
   */
  public async getServices(category?: string) {
    return await prisma.dentalService.findMany({
      where: {
        isActive: true,
        ...(category ? { category } : {})
      }
    });
  }

  /**
   * Map dental complaint to recommended service & specialization
   */
  public async matchServiceForComplaint(complaintText: string): Promise<{
    serviceCode: string;
    specialization: string;
  }> {
    const lower = (complaintText || '').toLowerCase();
    if (lower.includes('wisdom') || lower.includes('impacted') || lower.includes('extract')) {
      return { serviceCode: 'WISDOM_EXAM', specialization: 'Endodontics & Oral Surgery' };
    }
    if (lower.includes('root canal') || lower.includes('nerve') || lower.includes('deep throbbing')) {
      return { serviceCode: 'ROOT_CANAL', specialization: 'Endodontics & Oral Surgery' };
    }
    if (lower.includes('gum') || lower.includes('bleeding') || lower.includes('swelling') || lower.includes('periodont')) {
      return { serviceCode: 'GUM_EVAL', specialization: 'Periodontics & Implantology' };
    }
    if (lower.includes('missing') || lower.includes('implant') || lower.includes('bridge')) {
      return { serviceCode: 'IMPLANT_CONSULT', specialization: 'Periodontics & Implantology' };
    }
    if (lower.includes('broken') || lower.includes('chip') || lower.includes('crack') || lower.includes('fall')) {
      return { serviceCode: 'BROKEN_TOOTH_EXAM', specialization: 'General Dentistry' };
    }
    if (lower.includes('clean') || lower.includes('checkup') || lower.includes('polish') || lower.includes('routine')) {
      return { serviceCode: 'CLEANING', specialization: 'General Dentistry' };
    }
    if (lower.includes('white') || lower.includes('stain') || lower.includes('yellow')) {
      return { serviceCode: 'WHITENING', specialization: 'General Dentistry' };
    }
    // Default to acute toothache exam with general/oral specialist
    return { serviceCode: 'TOOTHACHE_EXAM', specialization: 'General Dentistry' };
  }

  /**
   * Compute real, non-fabricated available slots for a given date from Prisma database.
   */
  public async getAvailableSlots(
    dateStr: string, // YYYY-MM-DD
    dentistId?: string,
    serviceId?: string
  ): Promise<AvailableSlot[]> {
    const targetDate = new Date(`${dateStr}T00:00:00.000Z`);
    if (isNaN(targetDate.getTime())) {
      throw new Error(`Invalid date format provided: ${dateStr}. Expected YYYY-MM-DD.`);
    }

    const dayOfWeek = targetDate.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

    // 1. Fetch relevant service duration
    let durationMinutes = 30;
    let serviceName = '';
    if (serviceId) {
      const s = await prisma.dentalService.findUnique({ where: { id: serviceId } });
      if (s) {
        durationMinutes = s.durationMinutes || 30;
        serviceName = s.name;
      }
    }

    // 2. Fetch dentists
    const dentists = await prisma.dentist.findMany({
      where: {
        isActive: true,
        ...(dentistId ? { id: dentistId } : {})
      },
      include: {
        schedules: {
          where: { dayOfWeek, isWorkingDay: true }
        }
      }
    });

    const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

    const availableSlots: AvailableSlot[] = [];

    for (const dentist of dentists) {
      const schedule = dentist.schedules[0];
      if (!schedule || !schedule.isWorkingDay) {
        continue; // Closed on this day of week
      }

      // Fetch existing bookings for this dentist on this date
      const existingAppointments = await prisma.appointment.findMany({
        where: {
          dentistId: dentist.id,
          status: { in: ['scheduled', 'confirmed'] },
          appointmentDateTime: { gte: dayStart, lte: dayEnd }
        }
      });

      // Fetch blocked slots
      const blockedSlots = await prisma.blockedSlot.findMany({
        where: {
          OR: [
            { dentistId: dentist.id },
            { dentistId: null } // clinic-wide block
          ],
          startDateTime: { lte: dayEnd },
          endDateTime: { gte: dayStart }
        }
      });

      // Parse schedule start/end (e.g. "09:00" to "17:00")
      const [startHour, startMin] = schedule.startTime.split(':').map(Number);
      const [endHour, endMin] = schedule.endTime.split(':').map(Number);
      const slotStep = schedule.slotDurationMinutes || 30;

      let currentMinOfDay = startHour * 60 + startMin;
      const endMinOfDay = endHour * 60 + endMin;

      while (currentMinOfDay + durationMinutes <= endMinOfDay) {
        const h = Math.floor(currentMinOfDay / 60);
        const m = currentMinOfDay % 60;
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

        const slotStart = new Date(`${dateStr}T${timeStr}:00.000Z`);
        const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);

        // Check if overlaps with blocked slot
        const isBlocked = blockedSlots.some(b => {
          return slotStart < b.endDateTime && slotEnd > b.startDateTime;
        });

        // Check if overlaps with existing appointment
        const isBooked = existingAppointments.some(a => {
          return slotStart < a.endDateTime && slotEnd > a.appointmentDateTime;
        });

        if (!isBlocked && !isBooked) {
          availableSlots.push({
            dentistId: dentist.id,
            dentistName: dentist.name,
            specialization: dentist.specialization,
            serviceId,
            serviceName,
            dateStr,
            timeStr,
            displayTime: this.formatDisplayTime(timeStr),
            startDateTime: slotStart,
            endDateTime: slotEnd
          });
        }

        currentMinOfDay += slotStep;
      }
    }

    return availableSlots;
  }

  /**
   * Atomic, transaction-safe appointment booking
   */
  public async bookAppointment(input: BookAppointmentInput) {
    const {
      patientName,
      patientPhone,
      patientEmail,
      dentistId,
      serviceId,
      appointmentDateTime,
      chiefComplaint,
      callRecordId,
      actorType = 'ai_voice',
      actorId
    } = input;

    const cleanedPhone = patientPhone.replace(/[^\d+]/g, '');
    if (!cleanedPhone || cleanedPhone.length < 7) {
      throw new Error('Valid patient phone number (at least 7 digits) is required for booking');
    }
    if (!patientName || patientName.trim().length < 2) {
      throw new Error('Patient name must be at least 2 characters');
    }

    const startDateTime = new Date(appointmentDateTime);
    if (isNaN(startDateTime.getTime())) {
      throw new Error('Invalid appointment date/time specified');
    }

    // Run within interactive Prisma transaction to prevent concurrent slot race conditions
    return await prisma.$transaction(async (tx) => {
      // 1. Verify service exists
      const service = await tx.dentalService.findUnique({
        where: { id: serviceId }
      });
      if (!service) {
        throw new Error(`Dental service with ID ${serviceId} not found`);
      }

      const durationMinutes = service.durationMinutes || 30;
      const endDateTime = new Date(startDateTime.getTime() + durationMinutes * 60000);

      // 2. Verify dentist exists
      const dentist = await tx.dentist.findUnique({
        where: { id: dentistId }
      });
      if (!dentist || !dentist.isActive) {
        throw new Error(`Dentist with ID ${dentistId} is not available`);
      }

      // 3. Verify schedule allows this time
      const dayOfWeek = startDateTime.getUTCDay();
      const schedule = await tx.dentistSchedule.findUnique({
        where: {
          dentistId_dayOfWeek: {
            dentistId,
            dayOfWeek
          }
        }
      });
      if (!schedule || !schedule.isWorkingDay) {
        throw new Error(`${dentist.name} does not have clinic hours on this day`);
      }

      // 4. Verify no overlapping appointments for this dentist
      const overlapping = await tx.appointment.findFirst({
        where: {
          dentistId,
          status: { in: ['scheduled', 'confirmed'] },
          appointmentDateTime: { lt: endDateTime },
          endDateTime: { gt: startDateTime }
        }
      });
      if (overlapping) {
        throw new Error(`The requested time slot with ${dentist.name} has just been reserved. Please select another slot.`);
      }

      // 5. Verify no blocked slots
      const blocked = await tx.blockedSlot.findFirst({
        where: {
          OR: [{ dentistId }, { dentistId: null }],
          startDateTime: { lt: endDateTime },
          endDateTime: { gt: startDateTime }
        }
      });
      if (blocked) {
        throw new Error(`The clinic or dentist is unavailable during this time (${blocked.reason}).`);
      }

      // 6. Get or create patient inside transaction
      let patient = await tx.patient.findUnique({
        where: { phone: cleanedPhone }
      });
      if (!patient) {
        patient = await tx.patient.create({
          data: {
            name: patientName.trim(),
            phone: cleanedPhone,
            email: patientEmail ? patientEmail.trim().toLowerCase() : null
          }
        });
      }

      // 7. Prevent duplicate active booking for the exact same patient at the exact same time
      const duplicatePatientBooking = await tx.appointment.findFirst({
        where: {
          patientId: patient.id,
          status: { in: ['scheduled', 'confirmed'] },
          appointmentDateTime: startDateTime
        }
      });
      if (duplicatePatientBooking) {
        throw new Error(`Patient already has an active appointment at this date and time (Ref: ${duplicatePatientBooking.bookingReference}).`);
      }

      // 8. Generate unique booking reference
      let bookingReference = this.generateBookingReference();
      let collision = await tx.appointment.findUnique({ where: { bookingReference } });
      while (collision) {
        bookingReference = this.generateBookingReference();
        collision = await tx.appointment.findUnique({ where: { bookingReference } });
      }

      // 9. Create Appointment
      const appointment = await tx.appointment.create({
        data: {
          bookingReference,
          patientId: patient.id,
          dentistId,
          serviceId,
          appointmentDateTime: startDateTime,
          endDateTime,
          durationMinutes,
          status: 'confirmed',
          chiefComplaint: chiefComplaint || 'Dental consultation',
          callRecordId: callRecordId || null
        },
        include: {
          patient: true,
          dentist: true,
          service: true
        }
      });

      // 10. Write BookingAuditLog
      await tx.bookingAuditLog.create({
        data: {
          appointmentId: appointment.id,
          bookingReference,
          action: 'CREATED',
          actorType,
          actorId: actorId || null,
          details: JSON.stringify({
            service: service.name,
            dentist: dentist.name,
            dateTime: startDateTime.toISOString(),
            complaint: chiefComplaint
          })
        }
      });

      return appointment;
    });
  }

  /**
   * Reschedule appointment
   */
  public async rescheduleAppointment(
    bookingReference: string,
    newStartDateTime: Date,
    actorType: string = 'ai_voice',
    actorId?: string
  ) {
    const startDateTime = new Date(newStartDateTime);
    if (isNaN(startDateTime.getTime())) {
      throw new Error('Invalid new appointment date/time specified');
    }

    return await prisma.$transaction(async (tx) => {
      const existing = await tx.appointment.findUnique({
        where: { bookingReference },
        include: { service: true, dentist: true, patient: true }
      });

      if (!existing) {
        throw new Error(`Appointment with booking reference ${bookingReference} not found`);
      }

      if (existing.status === 'cancelled') {
        throw new Error(`Appointment ${bookingReference} has already been cancelled`);
      }

      const durationMinutes = existing.durationMinutes || 30;
      const newEndDateTime = new Date(startDateTime.getTime() + durationMinutes * 60000);

      // Check slot availability excluding current appointment
      const overlapping = await tx.appointment.findFirst({
        where: {
          id: { not: existing.id },
          dentistId: existing.dentistId,
          status: { in: ['scheduled', 'confirmed'] },
          appointmentDateTime: { lt: newEndDateTime },
          endDateTime: { gt: startDateTime }
        }
      });
      if (overlapping) {
        throw new Error(`The new slot is not available. Please choose another time.`);
      }

      const updated = await tx.appointment.update({
        where: { id: existing.id },
        data: {
          appointmentDateTime: startDateTime,
          endDateTime: newEndDateTime,
          status: 'confirmed',
          rescheduledFromId: existing.id
        },
        include: {
          patient: true,
          dentist: true,
          service: true
        }
      });

      await tx.bookingAuditLog.create({
        data: {
          appointmentId: updated.id,
          bookingReference,
          action: 'RESCHEDULED',
          actorType,
          actorId: actorId || null,
          details: JSON.stringify({
            previousDateTime: existing.appointmentDateTime.toISOString(),
            newDateTime: startDateTime.toISOString()
          })
        }
      });

      return updated;
    });
  }

  /**
   * Cancel appointment
   */
  public async cancelAppointment(
    bookingReference: string,
    cancellationReason?: string,
    actorType: string = 'ai_voice',
    actorId?: string
  ) {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.appointment.findUnique({
        where: { bookingReference },
        include: { patient: true, dentist: true, service: true }
      });

      if (!existing) {
        throw new Error(`Appointment with booking reference ${bookingReference} was not found`);
      }

      if (existing.status === 'cancelled') {
        return existing;
      }

      const cancelled = await tx.appointment.update({
        where: { id: existing.id },
        data: {
          status: 'cancelled',
          cancellationReason: cancellationReason || 'Cancelled by patient'
        },
        include: {
          patient: true,
          dentist: true,
          service: true
        }
      });

      await tx.bookingAuditLog.create({
        data: {
          appointmentId: cancelled.id,
          bookingReference,
          action: 'CANCELLED',
          actorType,
          actorId: actorId || null,
          details: JSON.stringify({
            reason: cancellationReason || 'Patient request'
          })
        }
      });

      return cancelled;
    });
  }

  /**
   * Find appointment by booking reference
   */
  public async getAppointmentByReference(bookingReference: string) {
    return await prisma.appointment.findUnique({
      where: { bookingReference: bookingReference.trim().toUpperCase() },
      include: {
        patient: true,
        dentist: true,
        service: true,
        auditLogs: true
      }
    });
  }
}

export const dentalAppointmentService = new DentalAppointmentService();

