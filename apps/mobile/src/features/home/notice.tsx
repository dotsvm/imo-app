/** A list's empty or error state: what happened, why, and what to do. */
import { StyleSheet, Text, View } from "react-native";
import { Button } from "~/components/button";
import { color, font, space, text } from "~/theme/tokens";

interface Props {
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
}

export function Notice({ title, body, action }: Props) {
  return (
    <View style={styles.notice}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {action ? <Button variant="outline" label={action.label} onPress={action.onPress} style={styles.action} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { alignItems: "center", gap: space[2], paddingHorizontal: space[6], paddingTop: space[6] * 2 },
  title: { fontFamily: font.medium, fontSize: text.post, color: color.text },
  body: { fontFamily: font.regular, fontSize: text.body, color: color.neutral700, textAlign: "center", lineHeight: 20 },
  action: { marginTop: space[3] },
});
