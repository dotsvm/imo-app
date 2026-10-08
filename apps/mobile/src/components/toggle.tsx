/** The platform switch in imo's colors: money green when on, a faint track when off. */
import { Switch } from "react-native";
import { color } from "~/theme/tokens";

const OFF = "rgba(255, 255, 255, 0.14)";

interface Props {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Toggle({ value, onChange, label, disabled }: Props) {
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      trackColor={{ false: OFF, true: color.gain }}
      thumbColor="#f4f5f1"
      ios_backgroundColor={OFF}
      accessibilityLabel={label}
    />
  );
}
