import { routeParam } from "@imo/core/paths";
import { PostDetail } from "@/features/post";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = routeParam((await params).id);
  return <PostDetail key={id} id={id} />;
}
