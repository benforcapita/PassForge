import * as Clipboard from "expo-clipboard";
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { Fingerprint } from "../../components/Fingerprint";
import { Button, Card, Field, Notice, Screen, Stepper, Title, Toggle, styles } from "../../components/ui";
import { copyWithWipe } from "../../lib/clipboard";
import { generatePassword } from "../../lib/generate";
import { saveProfile } from "../../lib/profiles";
import { secureStore } from "../../lib/secure-store";
import { loadServers, type ActiveServer } from "../../lib/servers";
import { session, useSession } from "../../lib/session";
import { colors } from "../../theme";

const clipboard = {
  set: (value: string) => Clipboard.setStringAsync(value),
  get: () => Clipboard.getStringAsync(),
  schedule: (fn: () => void, ms: number) => setTimeout(fn, ms),
};

export default function GenerateScreen() {
  const { draft, masterPassword } = useSession();
  const [server, setServer] = useState<ActiveServer | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  useFocusEffect(
    useCallback(() => {
      void loadServers(secureStore).then((s) => setServer(s.active));
    }, []),
  );

  const update = (patch: Partial<typeof draft>) => {
    setPassword(null);
    session.setDraft(patch);
  };

  const generate = () => {
    setBusy(true);
    setMessage(null);
    // Let the spinner render before PBKDF2 occupies the JS thread.
    setTimeout(() => {
      generatePassword(draft, masterPassword, server)
        .then(({ password }) => {
          setPassword(password);
          setRevealed(false);
        })
        .catch((e: unknown) => setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) }))
        .finally(() => setBusy(false));
    }, 16);
  };

  const copy = async () => {
    if (!password) return;
    await copyWithWipe(password, clipboard);
    setMessage({ tone: "info", text: "Copied. The clipboard clears in 30 seconds." });
  };

  const save = async () => {
    await saveProfile(secureStore, draft);
    setMessage({ tone: "info", text: `Saved profile for ${draft.site}.` });
  };

  const classes = [draft.lowercase, draft.uppercase, draft.digits, draft.symbols].filter(Boolean).length;

  return (
    <Screen>
      <Title subtitle={server ? `server · ${new URL(server.url).host} · ${server.algorithm ?? "default"}` : "no algorithm server"}>
        PassForge
      </Title>

      {!server ? (
        <Notice>
          Add an algorithm server to generate passwords. PassForge on iOS has no built-in algorithm:{" "}
          <Link href="/servers" style={{ color: colors.accent, fontWeight: "600" }}>
            open Servers
          </Link>
          .
        </Notice>
      ) : null}

      <Card>
        <Field label="Site" value={draft.site} onChangeText={(site) => update({ site })} placeholder="github.com" keyboardType="url" />
        <Field label="Login" value={draft.login} onChangeText={(login) => update({ login })} placeholder="you@example.com" />
        <View style={{ gap: 6 }}>
          <Field
            label="Master password"
            value={masterPassword}
            onChangeText={(v) => {
              setPassword(null);
              session.setMasterPassword(v);
            }}
            secureTextEntry
            textContentType="none"
            placeholder="never stored"
          />
          <Fingerprint masterPassword={masterPassword} />
        </View>
      </Card>

      <Card>
        <Stepper label="Counter" value={draft.counter} min={1} max={9999} onChange={(counter) => update({ counter })} />
        <Stepper label="Length" value={draft.length} min={Math.max(4, classes)} max={128} onChange={(length) => update({ length })} />
        <Toggle label="a-z" value={draft.lowercase} onChange={(lowercase) => (classes > 1 || !lowercase ? update({ lowercase }) : undefined)} />
        <Toggle label="A-Z" value={draft.uppercase} onChange={(uppercase) => (classes > 1 || !uppercase ? update({ uppercase }) : undefined)} />
        <Toggle label="0-9" value={draft.digits} onChange={(digits) => (classes > 1 || !digits ? update({ digits }) : undefined)} />
        <Toggle label="%!@" value={draft.symbols} onChange={(symbols) => (classes > 1 || !symbols ? update({ symbols }) : undefined)} />
      </Card>

      <Button title="Generate" onPress={generate} busy={busy} disabled={!server || !draft.site || !masterPassword} />

      {password ? (
        <Card>
          <Text selectable={revealed} style={styles.mono}>
            {revealed ? password : "•".repeat(Math.min(password.length, 24))}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button variant="ghost" title={revealed ? "Hide" : "Reveal"} onPress={() => setRevealed((r) => !r)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Copy" onPress={() => void copy()} />
            </View>
          </View>
          <Button variant="ghost" title="Save profile" onPress={() => void save()} />
        </Card>
      ) : null}

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </Screen>
  );
}
