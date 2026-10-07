// URL and URLSearchParams in full, for the Supabase client. First, before anything uses them.
import "react-native-url-polyfill/auto";
// One import per weight: the packages' index would bundle every weight they ship.
import { Geist_400Regular } from "@expo-google-fonts/geist/400Regular";
import { Geist_500Medium } from "@expo-google-fonts/geist/500Medium";
import { Geist_600SemiBold } from "@expo-google-fonts/geist/600SemiBold";
import { InstrumentSerif_400Regular } from "@expo-google-fonts/instrument-serif/400Regular";
import { InstrumentSerif_400Regular_Italic } from "@expo-google-fonts/instrument-serif/400Regular_Italic";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { prepareAuth, useConfig } from "~/features/auth/auth";
import { useAccount } from "~/features/auth/use-account";
import { WalletProvider } from "~/features/wallet/wallet";
import { color } from "~/theme/tokens";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: color.bg, card: color.bg, text: color.text, border: color.divider, primary: color.pos },
};

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.bg }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={theme}>
          <StatusBar style="light" />
          <WalletProvider>
            <App />
          </WalletProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

/** Each account sees one part of the app: signed out, gated, onboarding, or in. */
function App() {
  const [fontsLoaded, fontError] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
  });
  const config = useConfig();
  const { phase } = useAccount();

  useEffect(() => {
    if (config.data) prepareAuth(config.data);
  }, [config.data]);

  // A font that fails to load falls back to the system face; it shouldn't keep the app closed.
  const ready = (fontsLoaded || !!fontError) && phase !== "loading";
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg }, animation: "fade" }}>
      <Stack.Protected guard={phase === "in"}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="compose" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
        <Stack.Screen name="pick-market" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="search" options={{ animation: "fade" }} />
        <Stack.Screen name="post/[id]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="market/[id]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="position/[id]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="room/[id]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="new-room" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
        <Stack.Screen name="watchlists" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="leaderboard" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="trader/[handle]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="notifications" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="settings" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="wallet" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="deposit" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="withdraw" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="notification-settings" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="edit-profile" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
      </Stack.Protected>
      <Stack.Protected guard={phase === "signed-out"}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={phase === "gated"}>
        <Stack.Screen name="invite" />
      </Stack.Protected>
      <Stack.Protected guard={phase === "onboarding"}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Screen name="auth-callback" />
    </Stack>
  );
}
