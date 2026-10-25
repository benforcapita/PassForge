import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Card, Notice, Screen, Title, styles } from "../../components/ui";
import { deleteProfile, loadProfiles, type SavedProfile } from "../../lib/profiles";
import { secureStore } from "../../lib/secure-store";
import { session } from "../../lib/session";

export default function ProfilesScreen() {
  const [profiles, setProfiles] = useState<SavedProfile[]>([]);

  useFocusEffect(
    useCallback(() => {
      void loadProfiles(secureStore).then(setProfiles);
    }, []),
  );

  const open = ({ id: _id, ...draft }: SavedProfile) => {
    session.setDraft(draft);
    router.navigate("/");
  };

  return (
    <Screen>
      <Title subtitle="Parameters only — passwords are regenerated, never stored.">Profiles</Title>
      {profiles.length === 0 ? <Notice tone="info">Generate a password and tap “Save profile” to keep its parameters here.</Notice> : null}
      {profiles.map((p) => (
        <Card key={p.id}>
          <Pressable accessibilityRole="button" onPress={() => open(p)} style={{ gap: 2 }}>
            <Text style={[styles.body, { fontWeight: "600" }]}>{p.site}</Text>
            <Text style={styles.muted}>
              {p.login || "no login"} · #{p.counter} · {p.length} chars
            </Text>
          </Pressable>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button title="Use" onPress={() => open(p)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button variant="danger" title="Delete" onPress={() => void deleteProfile(secureStore, p.id).then(setProfiles)} />
            </View>
          </View>
        </Card>
      ))}
    </Screen>
  );
}
