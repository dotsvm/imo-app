import { routeParam } from "@imo/core/paths";
import { MarketDetail } from "@/features/market";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = routeParam((await params).id);
  return <MarketDetail key={id} id={id} />;
}
