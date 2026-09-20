import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { getPublicOrder } from "@/lib/store/orders";
import OrderStatus from "@/components/notes/OrderStatus";
import {
  STORE_ORDER_ACCESS_COOKIE,
  parseOrderAccessCookie,
} from "@/lib/store/accessToken";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export const metadata = {
  title: "Order status — Naman IAS Notes",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer" as const,
};

function resolveAccessToken(orderNumber: string, searchParams?: { t?: string }): string | null {
  const fromQuery = (searchParams?.t || "").trim();
  if (fromQuery) return fromQuery;
  const jar = cookies().get(STORE_ORDER_ACCESS_COOKIE)?.value;
  const parsed = parseOrderAccessCookie(jar, orderNumber);
  return parsed?.token || null;
}

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: { orderNumber: string };
  searchParams?: { t?: string };
}) {
  noStore();
  const orderNo = decodeURIComponent(params.orderNumber || "").trim().toUpperCase();
  const token = resolveAccessToken(orderNo, searchParams);
  if (!token) {
    return (
      <div className="container-wide py-16">
        <div className="mx-auto max-w-lg text-center">
          <h1 className="font-heading text-2xl font-bold text-[var(--ca-navy)]">Confirm this order</h1>
          <p className="mt-3 text-sm text-[var(--ca-navy)]/70">
            Open this page from the device you used to pay, or look up the order with your phone number.
          </p>
          <Link
            href="/notes/track"
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--ca-navy)] px-6 text-sm font-semibold text-white"
          >
            Track an order
          </Link>
        </div>
      </div>
    );
  }
  const order = await getPublicOrder(orderNo, { trackingToken: token });
  if (!order) notFound();
  return (
    <div className="container-wide py-12">
      <OrderStatus order={order} />
    </div>
  );
}
