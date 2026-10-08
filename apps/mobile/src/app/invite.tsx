/**
 * The beta's gate: signed in, but the account has no access yet. An invite
 * code lets them in; otherwise, the waitlist. If they hold a place on it,
 * their pass and place in line show above the code field.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { WaitlistStatusDTO } from "@imo/server/dto/api-types";
import { Avatar } from "~/components/avatar";
import { Button } from "~/components/button";
import { signOut, useConfig } from "~/features/auth/auth";
import { Lede, Problem, Screen, Title } from "~/features/auth/parts";
import { api } from "~/lib/api";
import { color, font, radius, space, text } from "~/theme/tokens";

export default function Invite() {
  const queryClient = useQueryClient();
  const config = useConfig().data;
  const status = useQuery({
    queryKey: ["waitlist", "me"],
    queryFn: ({ signal }) => api<WaitlistStatusDTO | null>("/waitlist/me", { signal }),
  }).data;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const clean = code.trim();

  async function redeem() {
    setBusy(true);
    setProblem(null);
    try {
      await api("/invites/redeem", { body: { code: clean } });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That code didn't work.");
      setBusy(false);
    }
  }

  return (
    <Screen
      footer={
        <>
          <Button size="lg" label="Get in" onPress={redeem} loading={busy} disabled={clean.length < 8} />
          <Pressable onPress={signOut} hitSlop={8} style={styles.signOut} accessibilityRole="button">
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </>
      }
    >
      <Title after="progress">imo is invite-only for now</Title>
      <Lede>Have an invite code? Enter it to get in. Friends who are in can send you one.</Lede>
      {status?.onList ? (
        <View style={styles.pass} accessible accessibilityLabel={`@${status.handle}, pass ${status.pass}${status.position ? `, number ${status.position} in line` : ""}`}>
          <Avatar url={status.avatarUrl} size={36} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.passHandle}>@{status.handle}</Text>
            <Text style={styles.passMeta}>
              Pass #{status.pass}
              {status.founding ? " · Founding" : ""}
            </Text>
          </View>
          {status.position ? <Text style={styles.passPlace}>#{status.position.toLocaleString("en-US")} in line</Text> : null}
        </View>
      ) : null}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Invite code</Text>
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="XXXX-XXXX"
          placeholderTextColor={color.neutral600}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          returnKeyType="go"
          onSubmitEditing={() => clean.length >= 8 && redeem()}
          style={styles.input}
          accessibilityLabel="Invite code"
        />
      </View>
      <Problem message={problem} />
      {config?.waitlistUrl && status?.onList !== true ? (
        <Pressable onPress={() => WebBrowser.openBrowserAsync(config.waitlistUrl!)} hitSlop={8} style={styles.waitlist}>
          <Text style={styles.waitlistText}>No code? Join the waitlist</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: {
    marginTop: space[5],
    paddingHorizontal: space[4],
    paddingTop: 10,
    paddingBottom: 8,
    borderRadius: radius.panel,
    backgroundColor: color.neutral100,
    borderWidth: 1,
    borderColor: color.neutral400,
  },
  fieldLabel: { fontFamily: font.regular, fontSize: text.label, color: color.neutral700 },
  input: { fontFamily: font.medium, fontSize: 18, letterSpacing: 1.5, color: color.text, paddingVertical: 6 },
  waitlist: { marginTop: space[4] },
  pass: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: space[5],
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 18,
    borderRadius: radius.pill,
    backgroundColor: "rgba(14, 19, 16, 0.85)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  passHandle: { fontFamily: font.medium, fontSize: 14, color: color.text },
  passMeta: { fontFamily: font.regular, fontSize: 12, color: color.muted, fontVariant: ["tabular-nums"] },
  passPlace: { fontFamily: font.medium, fontSize: 13, color: color.gold, fontVariant: ["tabular-nums"] },
  waitlistText: { fontFamily: font.medium, fontSize: text.body, color: color.pos },
  signOut: { alignSelf: "center", paddingVertical: space[1] },
  signOutText: { fontFamily: font.medium, fontSize: text.body, color: color.neutral700 },
});
