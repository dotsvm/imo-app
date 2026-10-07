import { routeParam } from "@imo/core/paths";
import { Profile } from "@/features/profile";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = routeParam((await params).id);
  return <Profile key={id} id={id} />;
}
