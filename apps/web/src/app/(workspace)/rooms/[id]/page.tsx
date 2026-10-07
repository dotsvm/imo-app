import { routeParam } from "@imo/core/paths";
import { RoomDetail } from "@/features/room";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = routeParam((await params).id);
  return <RoomDetail key={id} id={id} />;
}
