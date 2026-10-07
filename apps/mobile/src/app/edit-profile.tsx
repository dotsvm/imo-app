/** Edit what others see: your name, handle, focus and bio. */
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "~/components/button";
import { BackChevron, Problem, Screen, Title } from "~/features/auth/parts";
import { useMe } from "~/features/auth/use-account";
import { api } from "~/lib/api";
import { color, font, radius, space, text } from "~/theme/tokens";

export default function EditProfile() {
  const queryClient = useQueryClient();
  const me = useMe().data;
  const [name, setName] = useState(me?.user.displayName ?? "");
  const [handle, setHandle] = useState(me?.user.handle ?? "");
  const [focus, setFocus] = useState(me?.user.focus ?? "");
  const [bio, setBio] = useState(me?.user.bio ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const cleanHandle = handle.trim().replace(/^@/, "");
  const valid = name.trim().length > 0 && /^[A-Za-z0-9_]{2,24}$/.test(cleanHandle);

  async function save() {
    if (!me) return;
    setBusy(true);
    setProblem(null);
    try {
      await api("/me", {
        method: "PATCH",
        body: {
          displayName: name.trim(),
          focus: focus.trim(),
          bio: bio.trim(),
          ...(cleanHandle !== me.user.handle ? { handle: cleanHandle } : {}),
        },
      });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["me"] }), queryClient.invalidateQueries({ queryKey: ["trader"] })]);
      router.back();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Couldn't save. Try again.");
      setBusy(false);
    }
  }

  return (
    <Screen
      footer={
        <>
          <Button size="lg" label="Save" onPress={save} disabled={!valid} loading={busy} />
          <Pressable onPress={() => router.back()} hitSlop={8} style={styles.cancel} accessibilityRole="button">
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </>
      }
    >
      <BackChevron />
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Title>Edit profile</Title>
        <Field label="Name" value={name} onChange={setName} max={50} />
        <Field label="Handle" value={handle} onChange={setHandle} max={25} prefix="@" hint="2–24 letters, numbers or underscores" />
        <Field label="Focus" value={focus} onChange={setFocus} max={60} placeholder="Macro, sports" />
        <Field label="Bio" value={bio} onChange={setBio} max={280} multiline placeholder="What you trade and how." />
        <Problem message={problem} />
      </ScrollView>
    </Screen>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  placeholder?: string;
  multiline?: boolean;
  prefix?: string;
  hint?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <View style={styles.row}>
        {props.prefix ? <Text style={styles.prefix}>{props.prefix}</Text> : null}
        <TextInput
          value={props.value}
          onChangeText={props.onChange}
          placeholder={props.placeholder}
          placeholderTextColor={color.neutral600}
          maxLength={props.max}
          multiline={props.multiline}
          autoCapitalize={props.prefix ? "none" : "sentences"}
          autoCorrect={!props.prefix}
          style={[styles.input, props.multiline && { minHeight: 72 }]}
          accessibilityLabel={props.label}
        />
      </View>
      {props.hint ? <Text style={styles.hint}>{props.hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    marginTop: space[4],
    paddingHorizontal: space[4],
    paddingTop: 10,
    paddingBottom: 8,
    borderRadius: radius.panel,
    backgroundColor: color.neutral100,
    borderWidth: 1,
    borderColor: color.neutral400,
  },
  label: { fontFamily: font.regular, fontSize: text.label, color: color.neutral700 },
  row: { flexDirection: "row", alignItems: "center" },
  prefix: { fontFamily: font.regular, fontSize: 16, color: color.neutral600 },
  input: { flex: 1, fontFamily: font.regular, fontSize: 16, color: color.text, paddingVertical: 6, textAlignVertical: "top" },
  hint: { fontFamily: font.regular, fontSize: 11, color: color.neutral600 },
  cancel: { alignSelf: "center", paddingVertical: space[1] },
  cancelText: { fontFamily: font.medium, fontSize: text.body, color: color.neutral700 },
});
