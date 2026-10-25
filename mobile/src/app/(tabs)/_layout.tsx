import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Tabs } from "expo-router";
import { colors } from "../../theme";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.base, borderTopColor: colors.borderSubtle },
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Generate", tabBarIcon: ({ color }) => <FontAwesome size={22} name="key" color={color} /> }}
      />
      <Tabs.Screen
        name="profiles"
        options={{ title: "Profiles", tabBarIcon: ({ color }) => <FontAwesome size={22} name="list" color={color} /> }}
      />
      <Tabs.Screen
        name="servers"
        options={{ title: "Servers", tabBarIcon: ({ color }) => <FontAwesome size={22} name="server" color={color} /> }}
      />
    </Tabs>
  );
}
