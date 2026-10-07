/**
 * Where browser sign-in returns. The in-app browser usually catches this
 * address itself; if the system opens the app on it instead, carry on to
 * wherever the account belongs (the root layout decides).
 */
import { Redirect } from "expo-router";

export default function AuthCallback() {
  return <Redirect href="/" />;
}
