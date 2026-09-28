import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { getPublicOrder } from "@/lib/store/orders";
import OrderStatus from "@/components/notes/OrderStatus";
import TrackForm from "@/components/notes/TrackForm";
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
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ca-navy)]/50">Confirming your payment</p>
          <h1 className="mt-2 font-heading text-2xl font-bold text-[var(--ca-navy)]">Payment received — open your order</h1>
          <p className="mt-3 text-sm text-[var(--ca-navy)]/70">
            Your payment is being confirmed on our server. This page does not start another payment.
          </p>
          {orderNo ? (
            <p className="mt-4 font-mono text-sm font-semibold text-[var(--ca-navy)]">{orderNo}</p>
          ) : null}
          <TrackForm initialOrderNo={orderNo} />
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
