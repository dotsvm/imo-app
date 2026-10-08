/** Edit what others see: your name, handle (checked as you type), focus and bio. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { CheckCircleIcon } from "phosphor-react-native/src/icons/CheckCircle";
import { LockSimpleIcon } from "phosphor-react-native/src/icons/LockSimple";
import { WarningCircleIcon } from "phosphor-react-native/src/icons/WarningCircle";
import { XCircleIcon } from "phosphor-react-native/src/icons/XCircle";
import type { HandleAvailabilityDTO } from "@imo/server/dto/api-types";
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
  const wellFormed = /^[A-Za-z0-9_]{2,24}$/.test(cleanHandle);
  const changed = !!me && cleanHandle.toLowerCase() !== me.user.handle.toLowerCase();

  // Ask whether a new handle is free once typing pauses.
  const [checking, setChecking] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setChecking(cleanHandle), 600);
    return () => clearTimeout(timer);
  }, [cleanHandle]);
  const availability = useQuery({
    queryKey: ["handles", checking.toLowerCase()],
    queryFn: ({ signal }) => api<HandleAvailabilityDTO>(`/handles/${encodeURIComponent(checking)}`, { signal }),
    enabled: changed && wellFormed && checking === cleanHandle,
    staleTime: 30_000,
  });
  const verdict = !changed ? null : !wellFormed ? "invalid" : checking === cleanHandle && availability.data ? (availability.data.available ? "available" : availability.data.reason) : null;
  const handleNote: ReactNode =
    verdict === "available" ? (
      <Note icon={<CheckCircleIcon size={13} weight="fill" color={color.gain} />} tone={color.gain} text={`@${cleanHandle} is available`} />
    ) : verdict === "taken" ? (
      <Note icon={<XCircleIcon size={13} weight="fill" color={color.neg} />} tone={color.neg} text={`@${cleanHandle} is taken`} />
    ) : verdict === "reserved" ? (
      <Note icon={<LockSimpleIcon size={13} weight="fill" color={color.gold} />} tone={color.gold} text={`@${cleanHandle} is reserved`} />
    ) : verdict === "invalid" && cleanHandle.length >= 2 ? (
      <Note icon={<WarningCircleIcon size={13} weight="fill" color={color.neg} />} tone={color.neg} text="Letters, numbers or underscores only" />
    ) : null;
  const valid = name.trim().length > 0 && wellFormed && verdict !== "taken" && verdict !== "reserved";

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
        {handleNote}
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

function Note({ icon, tone, text: message }: { icon: ReactNode; tone: string; text: string }) {
  return (
    <View style={styles.note} accessibilityLiveRegion="polite">
      {icon}
      <Text style={[styles.noteText, { color: tone }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  note: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, marginLeft: 4 },
  noteText: { fontFamily: font.regular, fontSize: 12 },
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
