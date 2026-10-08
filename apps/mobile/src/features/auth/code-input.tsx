/**
 * Six boxes over one hidden field: typing, pasting and the keyboard's
 * one-time-code suggestion all land in the field; the boxes just show it.
 * The slot being typed into is underlined in green.
 */
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { color, font } from "~/theme/tokens";

const LENGTH = 6;

interface Props {
  value: string;
  onChange: (code: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
}

export function CodeInput({ value, onChange, onComplete, disabled }: Props) {
  const field = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  // Ready to type the moment it appears, after the tap that sent the code lets go.
  useEffect(() => {
    const timer = setTimeout(() => field.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, []);
  return (
    <Pressable onPress={() => field.current?.focus()} accessible={false}>
      <View style={styles.row}>
        {Array.from({ length: LENGTH }, (_, i) => {
          const active = focused && (i === value.length || (i === LENGTH - 1 && value.length === LENGTH));
          return (
            <View key={i} style={[styles.box, value[i] ? styles.filled : null, active && styles.active]}>
              <Text style={styles.digit}>{value[i] ?? ""}</Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={field}
        value={value}
        onChangeText={(text) => {
          const code = text.replace(/\D/g, "").slice(0, LENGTH);
          onChange(code);
          if (code.length === LENGTH) onComplete?.(code);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={!disabled}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={LENGTH}
        caretHidden
        accessibilityLabel="6-digit code"
        style={styles.hidden}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10 },
  box: {
    flex: 1,
    height: 52,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: "rgba(255, 255, 255, 0.12)",
  },
  filled: { borderBottomColor: "rgba(255, 255, 255, 0.5)" },
  active: { borderBottomColor: color.pos },
  digit: { fontFamily: font.semibold, fontSize: 26, lineHeight: 30, color: color.text, fontVariant: ["tabular-nums"] },
  // Present for the keyboard and autofill, invisible on screen.
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0 },
});
