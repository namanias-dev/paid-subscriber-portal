import { redirect } from "next/navigation";

/** Canonical entry to the People hub — lands on the default (operational) tab. */
export default function PeopleHub() {
  redirect("/admin/students");
}
