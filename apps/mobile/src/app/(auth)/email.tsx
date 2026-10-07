/**
 * Email in: the address, then the 6-digit code we send to it. No password.
 * New people get an account; "Sign in" only finds an existing one. Against a
 * local API with dev sign-in, the address signs straight in (no email goes out).
 */
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CheckCircleIcon } from "phosphor-react-native/src/icons/CheckCircle";
import { Button } from "~/components/button";
import { Rise } from "~/components/rise";
import { devSignIn, sendEmailCode, useConfig, verifyEmailCode } from "~/features/auth/auth";
import { CodeInput } from "~/features/auth/code-input";
import { BackChevron, Lede, Problem, Screen, Title } from "~/features/auth/parts";
import { color, font, space, text } from "~/theme/tokens";

type Mode = "signup" | "signin";
const RESEND_AFTER = 60;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function EmailSignIn() {
  const config = useConfig().data;
  const dev = !!config && !config.auth.email && config.auth.dev;
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const wait = useCountdown(sentAt);

  const address = email.trim().toLowerCase();
  const valid = EMAIL.test(address);
  // Editing the address after a code went out starts over.
  const codeSent = !!sentTo && sentTo === address;

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    try {
      await task();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const send = () =>
    run(async () => {
      if (!config) return;
      if (dev) return devSignIn(address);
      await sendEmailCode(config, address, mode);
      setCode("");
      setSentTo(address);
      setSentAt(Date.now());
    });

  // Signed in: the root layout moves on by itself.
  const verify = (value = code) => run(async () => config && verifyEmailCode(config, address, value));

  function switchMode() {
    setMode((m) => (m === "signup" ? "signin" : "signup"));
    setSentTo(null);
    setCode("");
    setProblem(null);
  }

  return (
    <Screen
      footer={
        <>
          <Button
            size="lg"
            label="Continue"
            onPress={codeSent ? () => verify() : send}
            disabled={!config || (codeSent ? code.length < 6 : !valid)}
            loading={busy}
          />
          {!dev ? (
            <Pressable onPress={switchMode} hitSlop={8} style={styles.switch} accessibilityRole="button">
              <Text style={styles.switchText}>
                {mode === "signup" ? "Have an account? " : "New to imo? "}
                <Text style={styles.switchAction}>{mode === "signup" ? "Sign in" : "Sign up"}</Text>
              </Text>
            </Pressable>
          ) : null}
        </>
      }
    >
      <BackChevron />
      <Title>{mode === "signup" ? "What’s your email?" : "Welcome back"}</Title>
      <Lede>{dev ? "Local server: any email signs straight in. No code needed." : "We’ll send a code. No password needed."}</Lede>

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor={color.neutral500}
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        returnKeyType={dev ? "go" : "send"}
        onSubmitEditing={() => valid && !codeSent && send()}
        style={styles.email}
        accessibilityLabel="Email"
      />

      {codeSent ? (
        <Rise duration={180}>
          <View style={styles.sent}>
            <CheckCircleIcon size={18} weight="fill" color={color.pos} />
            <Text style={styles.sentText}>Code sent</Text>
          </View>
          <Text style={styles.label}>Enter the 6-digit code</Text>
          <CodeInput value={code} onChange={setCode} onComplete={verify} disabled={busy} />
          {wait > 0 ? (
            <Text style={styles.hint}>Didn’t get it? Resend in 0:{String(wait).padStart(2, "0")}</Text>
          ) : (
            <Pressable onPress={send} hitSlop={8} accessibilityRole="button" disabled={busy}>
              <Text style={styles.hint}>
                Didn’t get it? <Text style={styles.resend}>Resend code</Text>
              </Text>
            </Pressable>
          )}
        </Rise>
      ) : null}

      <Problem message={problem} />
    </Screen>
  );
}

/** Seconds until another code may go out, counted from the last send. */
function useCountdown(sentAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!sentAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sentAt]);
  if (!sentAt) return 0;
  return Math.min(RESEND_AFTER, Math.max(0, RESEND_AFTER - Math.floor((now - sentAt) / 1000)));
}

const styles = StyleSheet.create({
  email: {
    marginTop: space[6],
    paddingVertical: space[2],
    fontFamily: font.regular,
    fontSize: 28,
    letterSpacing: -0.4,
    color: color.text,
  },
  sent: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: space[2] },
  sentText: { fontFamily: font.medium, fontSize: text.post, color: color.pos },
  label: { fontFamily: font.regular, fontSize: text.post, color: color.neutral700, marginTop: space[6], marginBottom: space[2] },
  hint: { fontFamily: font.regular, fontSize: text.post, color: color.neutral600, marginTop: space[4] },
  resend: { fontFamily: font.medium, color: color.pos },
  switch: { alignSelf: "center", paddingVertical: space[1] },
  switchText: { fontFamily: font.regular, fontSize: 16, color: color.neutral700 },
  switchAction: { fontFamily: font.semibold, color: color.text },
});
