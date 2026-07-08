import type {
  FormField,
  CareerJobType,
  CareerRoleType,
  ApplicationStatus,
} from "./types";

/**
 * Careers module — static config + sensible defaults. The subject list and the
 * application-form template are seeded from here but are fully admin-editable
 * afterwards (stored in careers_settings).
 */

/** Default master subject list (admin-editable via Careers → Settings). */
export const DEFAULT_CAREER_SUBJECTS: string[] = [
  "GS",
  "Polity",
  "History",
  "Economy",
  "Science and Technology",
  "CSAT",
  "Geography",
  "Environment",
  "Ethics",
  "Current Affairs",
  "Essay",
  "International Relations",
  "Sociology",
  "Public Administration",
];

/** Indian States + Union Territories for the location dropdown. */
export const INDIAN_STATES: string[] = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  // Union Territories
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
];

export const ROLE_TYPE_LABELS: Record<string, string> = {
  faculty: "Faculty",
  video_editor: "Video Editor",
  other: "Other",
};

export const JOB_TYPE_LABELS: Record<CareerJobType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  freelance: "Freelance",
  internship: "Internship",
};

export const JOB_TYPES: CareerJobType[] = [
  "full_time",
  "part_time",
  "contract",
  "freelance",
  "internship",
];

export const ROLE_TYPES: CareerRoleType[] = ["faculty", "video_editor", "other"];

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "new",
  "shortlisted",
  "interviewing",
  "rejected",
  "hired",
];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  new: "New",
  shortlisted: "Shortlisted",
  interviewing: "Interviewing",
  rejected: "Rejected",
  hired: "Hired",
};

// ---------------------------------------------------------------------------
//  File upload rules (applicant resumes / marksheets / proofs)
// ---------------------------------------------------------------------------
export const RESUME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
export const PROOF_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];
export const CAREER_ALLOWED_UPLOAD_TYPES = Array.from(
  new Set([...RESUME_TYPES, ...PROOF_TYPES]),
);
export const CAREER_MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/** Map a MIME type to a safe file extension for R2 keys. */
export const CAREER_EXT_BY_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Default faculty application form. This is the template used when a position has
 * no custom form. Fully admin-configurable via the form builder afterwards.
 */
export function defaultFacultyFormFields(): FormField[] {
  return [
    { id: "full_name", label: "Full Name", type: "text", required: true, enabled: true, system: "full_name", placeholder: "Your full name" },
    { id: "phone", label: "Phone", type: "phone", required: true, enabled: true, system: "phone", placeholder: "10-digit mobile number" },
    { id: "email", label: "Email", type: "email", required: true, enabled: true, system: "email", placeholder: "you@example.com" },
    { id: "resume", label: "Resume", type: "file", required: true, enabled: true, system: "resume", accept: RESUME_TYPES, maxFiles: 1, help: "PDF, DOC or DOCX — up to 10MB." },
    { id: "upsc_attempts", label: "Number of times appeared for UPSC", type: "number", required: false, enabled: true, system: "upsc_attempts", min: 0, max: 20 },
    { id: "interview_attempts", label: "Number of times appeared for UPSC Interview / Personality Test", type: "number", required: false, enabled: true, system: "interview_attempts", min: 0, max: 20 },
    { id: "salary_expectation", label: "Salary expectation (₹ per month)", type: "number", required: false, enabled: true, system: "salary_expectation", min: 0 },
    { id: "state", label: "Current State", type: "dropdown", required: true, enabled: true, system: "state", optionsSource: "states" },
    { id: "city", label: "Current City", type: "text", required: true, enabled: true, system: "city", placeholder: "e.g. Chandigarh" },
    { id: "subjects", label: "Subjects you can teach", type: "multiselect", required: true, enabled: true, system: "subjects", optionsSource: "subjects", help: "Select all that apply." },
    { id: "upsc_roll_number", label: "UPSC Roll Number (optional)", type: "text", required: false, enabled: true, system: "upsc_roll_number" },
    { id: "marksheet", label: "Marksheet / proof (optional)", type: "file", required: false, enabled: true, system: "marksheet", accept: PROOF_TYPES, maxFiles: 1, help: "PDF or image — up to 10MB." },
    { id: "proof", label: "Additional resume / proof (optional)", type: "file", required: false, enabled: true, system: "proof", accept: CAREER_ALLOWED_UPLOAD_TYPES, maxFiles: 1 },
  ];
}

/** Human-readable salary range, e.g. "₹60,000 – ₹90,000 / month". */
export function formatSalaryRange(
  min: number | null | undefined,
  max: number | null | undefined,
  currency = "INR",
  period: "month" | "year" = "month",
): string | null {
  if (!min && !max) return null;
  const sym = currency === "INR" ? "₹" : `${currency} `;
  const fmt = (n: number) => sym + n.toLocaleString("en-IN");
  const per = period === "year" ? " / year" : " / month";
  if (min && max) return `${fmt(min)} – ${fmt(max)}${per}`;
  if (min) return `From ${fmt(min)}${per}`;
  return `Up to ${fmt(max as number)}${per}`;
}
