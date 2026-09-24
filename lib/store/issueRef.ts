import { randomBytes } from "node:crypto";

export function mintIssueReference(): string {
  return `NIAS-I-${randomBytes(4).toString("hex").toUpperCase()}`;
}
