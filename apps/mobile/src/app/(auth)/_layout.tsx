import { Stack } from "expo-router";
import { color } from "~/theme/tokens";

export const unstable_settings = { initialRouteName: "welcome" };

export default function Layout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }} />;
}
