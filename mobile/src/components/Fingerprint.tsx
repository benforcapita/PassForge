import FontAwesome from "@expo/vector-icons/FontAwesome";
import { createFingerprint } from "passforge-protocol";
import { useMemo } from "react";
import { View } from "react-native";
import { colors } from "../theme";

type IconName = keyof typeof FontAwesome.glyphMap;

/** The LessPass master-password fingerprint: three coloured glyphs. */
export function Fingerprint({ masterPassword }: { masterPassword: string }) {
  const fingers = useMemo(() => (masterPassword ? createFingerprint(masterPassword) : []), [masterPassword]);
  return (
    <View style={{ flexDirection: "row", gap: 6, minHeight: 28, alignItems: "center" }}>
      {fingers.map((finger, i) => {
        const name = finger.icon.replace(/^fa-/, "") as IconName;
        const known = name in FontAwesome.glyphMap;
        return (
          <View
            key={i}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              backgroundColor: colors.overlay,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <FontAwesome name={known ? name : "circle"} size={16} color={finger.color === "#000000" ? colors.textPrimary : finger.color} />
          </View>
        );
      })}
    </View>
  );
}
