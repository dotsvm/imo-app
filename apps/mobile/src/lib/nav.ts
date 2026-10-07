/** Where a person's name leads: your own profile tab, or their profile. */
import { router } from "expo-router";

export function openTrader(handle: string, isYou?: boolean) {
  if (isYou) router.navigate("/me");
  else router.push({ pathname: "/trader/[handle]", params: { handle } });
}
