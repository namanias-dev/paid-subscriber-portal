/**
 * Disposable portal accounts for installment-proof popup QA (State A / State B).
 * Never join grandfather_notice_queue or armed SMS cohorts.
 */
export const QA_INSTALLMENT_PROOF_MARKER = "DISPOSABLE_QA_INSTALLMENT_PROOF_POPUP";

export const QA_INSTALLMENT_PROOF_STUDENTS = {
  qa_expiring: {
    key: "qa_expiring" as const,
    phone: "9898900101",
    name: "Popup QA Expiring",
    /** State A: live allowed, instalment due in ~5 days. */
    state: "expiring" as const,
  },
  qa_blocked: {
    key: "qa_blocked" as const,
    phone: "9898900102",
    name: "Popup QA Blocked",
    /** State B: live playback blocked (grace ended). */
    state: "blocked" as const,
  },
} as const;

export const QA_INSTALLMENT_PROOF_PHONE_LIST: string[] = Object.values(QA_INSTALLMENT_PROOF_STUDENTS).map(
  (s) => s.phone,
);

export const QA_INSTALLMENT_PROOF_COURSE_ID = "co-safalta";

/**
 * Hard allowlist for teardown / wipe — live `students.id` values for the two
 * disposable QA accounts. Refuse any wipe whose resolved student id is not here.
 */
export const QA_INSTALLMENT_PROOF_STUDENT_IDS = {
  qa_expiring: "96412943-a83e-44aa-89d9-cf3bb698534f",
  qa_blocked: "4e1a1b59-6661-40cf-a7d3-e5c506e9b3fb",
} as const;

export const QA_INSTALLMENT_PROOF_STUDENT_ID_LIST: string[] = Object.values(QA_INSTALLMENT_PROOF_STUDENT_IDS);
