import { routeParam } from "@imo/core/paths";
import { PositionDetail } from "@/features/position";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = routeParam((await params).id);
  return <PositionDetail key={id} id={id} />;
}
