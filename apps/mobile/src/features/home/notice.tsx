/** A list's empty or error state: what happened, why, and what to do (one or two actions). */
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "~/components/button";
import { color, font, space, text } from "~/theme/tokens";

interface Action {
  label: string;
  onPress: () => void;
  icon?: ReactNode;
}

interface Props {
  title: string;
  body: string;
  /** A small glyph above the title. */
  icon?: ReactNode;
  /** The main way forward: primary when there's a second action, else outline. */
  action?: Action;
  secondary?: Action;
}

export function Notice({ title, body, icon, action, secondary }: Props) {
  return (
    <View style={styles.notice}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {action || secondary ? (
        <View style={styles.actions}>
          {action ? (
            <Button variant={secondary ? "primary" : "outline"} size="md" label={action.label} icon={action.icon} onPress={action.onPress} />
          ) : null}
          {secondary ? <Button variant="outline" size="md" label={secondary.label} icon={secondary.icon} onPress={secondary.onPress} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { alignItems: "center", gap: space[2], paddingHorizontal: space[6], paddingTop: space[6] * 2 },
  icon: { marginBottom: space[1] },
  title: { fontFamily: font.medium, fontSize: 17, color: color.text, textAlign: "center" },
  body: { fontFamily: font.regular, fontSize: text.body, color: color.neutral700, textAlign: "center", lineHeight: 20 },
  actions: { flexDirection: "row", gap: space[2], marginTop: space[3] },
});
