import { Tabs } from "expo-router/js-tabs";
import { TabBar } from "~/components/tab-bar";
import { color } from "~/theme/tokens";

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.bg } }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="discover" />
      <Tabs.Screen name="rooms" />
      <Tabs.Screen name="portfolio" />
      <Tabs.Screen name="me" />
    </Tabs>
  );
}
