import { getAdminSession } from "./session";

export async function requireAdmin(): Promise<boolean> {
  const session = await getAdminSession();
  return !!session;
}
