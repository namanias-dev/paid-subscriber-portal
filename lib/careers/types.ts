/**
 * Careers module — shared types. Kept isolated under lib/careers/ so nothing here
 * touches the rest of the app. All rich text is stored as sanitized HTML.
 */

export type CareerRoleType = "faculty" | "video_editor" | "other" | (string & {});
export type CareerJobType = "full_time" | "part_time" | "contract" | "freelance" | "internship";
export type CareerStatus = "draft" | "open" | "closed";
export type CareerSalaryPeriod = "month" | "year";

export type ApplicationStatus =
  | "new"
  | "shortlisted"
  | "interviewing"
  | "rejected"
  | "hired";

export type FormFieldType =
  | "text"
  | "textarea"
  | "email"
  | "phone"
  | "number"
  | "dropdown"
  | "multiselect"
  | "file";

/**
 * A `system` field maps 1:1 onto a first-class column on careers_applications.
 * Non-system fields are stored in the `answers` jsonb (custom questions).
 */
export type SystemFieldKey =
  | "full_name"
  | "phone"
  | "email"
  | "city"
  | "state"
  | "subjects"
  | "upsc_attempts"
  | "interview_attempts"
  | "salary_expectation"
  | "upsc_roll_number"
  | "resume"
  | "marksheet"
  | "proof";

export interface FormField {
  /** Stable key (used in `answers` + as the file "field" tag). */
  id: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  enabled: boolean;
  placeholder?: string;
  help?: string;
  /** Explicit options for dropdown/multiselect (when optionsSource === "custom"). */
  options?: string[];
  /** Dynamic option source: pull from the admin subject list or Indian states. */
  optionsSource?: "custom" | "subjects" | "states";
  /** Allowed MIME types for file fields. */
  accept?: string[];
  /** Max files for file fields (default 1). */
  maxFiles?: number;
  /** Numeric bounds for number fields. */
  min?: number;
  max?: number;
  /** Maps this field onto a core column; omit for custom questions. */
  system?: SystemFieldKey;
}

export interface UploadedFileMeta {
  field: string;
  key: string;
  name: string;
  content_type: string;
  size: number;
  uploaded_at: string;
}

export interface StatusHistoryEntry {
  status: ApplicationStatus;
  by: string | null;
  at: string;
  note?: string | null;
}

export interface CareerPosition {
  id: string;
  title: string;
  slug: string;
  role_type: CareerRoleType;
  location_city: string | null;
  location_state: string | null;
  job_type: CareerJobType;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  salary_period: CareerSalaryPeriod;
  subjects: string[];
  summary: string | null;
  description_html: string | null;
  requirements_html: string | null;
  status: CareerStatus;
  accepting_applications: boolean;
  form_fields: FormField[];
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface CareerApplication {
  id: string;
  position_id: string | null;
  position_title: string | null;
  position_slug: string | null;
  full_name: string;
  phone: string;
  email: string;
  city: string | null;
  state: string | null;
  subjects: string[];
  upsc_attempts: number | null;
  interview_attempts: number | null;
  salary_expectation: number | null;
  upsc_roll_number: string | null;
  answers: Record<string, unknown>;
  files: UploadedFileMeta[];
  status: ApplicationStatus;
  admin_notes: string | null;
  status_history: StatusHistoryEntry[];
  source: string | null;
  ip: string | null;
  created_at: string;
  updated_at: string;
}

export interface CareersSettings {
  id: string;
  accepting_applications: boolean;
  subjects: string[];
  default_form_fields: FormField[];
  notify_email: string | null;
  updated_at: string;
}

/** Position as exposed on the public site (no internal-only fields). */
export interface PublicPosition {
  id: string;
  title: string;
  slug: string;
  role_type: CareerRoleType;
  location_city: string | null;
  location_state: string | null;
  job_type: CareerJobType;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  salary_period: CareerSalaryPeriod;
  subjects: string[];
  summary: string | null;
  description_html: string | null;
  requirements_html: string | null;
  accepting_applications: boolean;
  form_fields: FormField[];
}
