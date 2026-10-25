import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Card, Field, Notice, Screen, Title, styles } from "../../components/ui";
import { secureStore } from "../../lib/secure-store";
import { addServer, loadServers, removeServer, useServer, type ServerState } from "../../lib/servers";
import { colors, radii } from "../../theme";

export default function ServersScreen() {
  const [state, setState] = useState<ServerState>({ servers: [], active: null });
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void loadServers(secureStore).then(setState);
    }, []),
  );

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await addServer(secureStore, url));
      setUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title subtitle="Self-hosted passforge-remote-v1 servers. The server only ever sees a blinded 32-byte hash.">
        Servers
      </Title>

      <Card>
        <Field
          label="Add server"
          value={url}
          onChangeText={setUrl}
          placeholder="https://algorithms.example.com"
          keyboardType="url"
          onSubmitEditing={() => void add()}
        />
        <Button title="Probe & add" onPress={() => void add()} busy={busy} disabled={!url.trim()} />
        {error ? <Notice tone="error">{error}</Notice> : null}
      </Card>

      {state.servers.length === 0 ? (
        <Notice>No server yet. Without one this app cannot generate passwords — that is by design.</Notice>
      ) : null}

      {state.servers.map(({ url: serverUrl, info }) => {
        const active = state.active?.url === serverUrl;
        return (
          <Card key={serverUrl}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.body, { fontWeight: "600" }]}>{info.name}</Text>
                <Text style={styles.muted}>
                  {serverUrl} · v{info.version}
                </Text>
              </View>
              {active ? <Text style={{ color: colors.success, fontWeight: "600" }}>Active</Text> : null}
            </View>
            {info.algorithms.map((alg) => {
              const selected = active && (state.active?.algorithm ?? info.default_algorithm) === alg.id;
              return (
                <Pressable
                  key={alg.id}
                  accessibilityRole="button"
                  onPress={() => void useServer(secureStore, { url: serverUrl, algorithm: alg.id }).then(setState)}
                  style={{
                    borderWidth: 1,
                    borderColor: selected ? colors.accent : colors.borderModerate,
                    backgroundColor: selected ? colors.accentMuted : colors.input,
                    borderRadius: radii.md,
                    padding: 10,
                    gap: 2,
                  }}
                >
                  <Text style={[styles.body, { fontFamily: "Menlo" }]}>{alg.id}</Text>
                  <Text style={styles.muted}>{alg.description}</Text>
                  {!alg.portable ? (
                    <Text style={{ color: colors.warning, fontSize: 12 }}>
                      Pepper: only this server can reproduce these passwords.
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
            <Button variant="danger" title="Remove" onPress={() => void removeServer(secureStore, serverUrl).then(setState)} />
          </Card>
        );
      })}
    </Screen>
  );
}
