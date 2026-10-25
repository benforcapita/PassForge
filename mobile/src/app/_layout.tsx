import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppState } from "react-native";
import { session } from "../lib/session";
import { colors } from "../theme";

export default function RootLayout() {
  // Forget the master password as soon as the app leaves the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") session.lock();
    });
    return () => sub.remove();
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ contentStyle: { backgroundColor: colors.canvas } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
