import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, mono, radii } from "../theme";

export function Screen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Title({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={styles.title}>{children}</Text>
      {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <TextInput
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, style]}
        {...rest}
      />
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  busy,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  busy?: boolean;
}) {
  const primary = variant === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.buttonPrimary : styles.buttonGhost,
        (disabled || busy) && { opacity: 0.45 },
        pressed && { opacity: 0.8 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? colors.textOnAccent : colors.accent} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            { color: primary ? colors.textOnAccent : variant === "danger" ? colors.error : colors.textPrimary },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.body}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.overlay }}
        thumbColor={colors.textPrimary}
      />
    </View>
  );
}

export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <View style={styles.row}>
      <Text style={styles.body}>{label}</Text>
      <View style={styles.stepper}>
        <Button variant="ghost" title="−" onPress={() => onChange(clamp(value - 1))} disabled={value <= min} />
        <Text style={[styles.body, styles.stepperValue]}>{value}</Text>
        <Button variant="ghost" title="+" onPress={() => onChange(clamp(value + 1))} disabled={value >= max} />
      </View>
    </View>
  );
}

export function Notice({ tone = "warning", children }: { tone?: "warning" | "error" | "info"; children: ReactNode }) {
  const palette =
    tone === "error"
      ? { bg: colors.errorBg, fg: colors.error }
      : tone === "info"
        ? { bg: colors.accentMuted, fg: colors.accentSecondary }
        : { bg: colors.warningBg, fg: colors.warning };
  return (
    <View style={[styles.notice, { backgroundColor: palette.bg }]}>
      <Text style={{ color: palette.fg, fontSize: 13 }}>{children}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  title: { color: colors.textPrimary, fontSize: 24, fontWeight: "700" },
  muted: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  body: { color: colors.textPrimary, fontSize: 15 },
  mono: { color: colors.textPrimary, fontFamily: mono, fontSize: 16 },
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6 },
  card: {
    backgroundColor: colors.raised,
    borderColor: colors.borderSubtle,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: 14,
    gap: 12,
  },
  input: {
    backgroundColor: colors.input,
    borderColor: colors.borderModerate,
    borderWidth: 1,
    borderRadius: radii.md,
    color: colors.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  button: { borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 10, alignItems: "center", justifyContent: "center", minHeight: 40 },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonGhost: { backgroundColor: colors.overlay, borderColor: colors.borderModerate, borderWidth: 1 },
  buttonText: { fontSize: 15, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepperValue: { minWidth: 36, textAlign: "center", fontFamily: mono },
  notice: { borderRadius: radii.md, padding: 12 },
});
