import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { getPublicOrder } from "@/lib/store/orders";
import OrderStatus from "@/components/notes/OrderStatus";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function OrderPage({ params }: { params: { orderNumber: string } }) {
  noStore();
  const order = await getPublicOrder(params.orderNumber);
  if (!order) notFound();
  return (
    <div className="container-wide py-12">
      <OrderStatus order={order} />
    </div>
  );
}
