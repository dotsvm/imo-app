import { Stack } from "expo-router";
import { color } from "~/theme/tokens";

export const unstable_settings = { initialRouteName: "interests" };

export default function Layout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }} />;
}
