import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PrimaryButton } from "@/components/UI";
import { useColors } from "@/hooks/useColors";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function LoginScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isWeb = Platform.OS === "web";

  const onSubmit = async () => {
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await Haptics.selectionAsync();
      await signIn(username.trim(), password);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.status === 401
            ? "Incorrect username or password."
            : e.message
          : e instanceof Error
            ? e.message
            : "Could not sign in.";
      setError(msg);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <LinearGradient
        colors={["#1F232B", "#2A1F12", "#5C3414"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          paddingTop: (isWeb ? 67 : insets.top) + 32,
          paddingHorizontal: 24,
          paddingBottom: 56,
          borderBottomLeftRadius: 32,
          borderBottomRightRadius: 32,
        }}
      >
        <View
          style={{
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 16,
            backgroundColor: "rgba(255,255,255,0.95)",
            alignSelf: "flex-start",
            marginBottom: 18,
          }}
        >
          <Image
            source={require("@/assets/images/platr-logo.png")}
            resizeMode="contain"
            style={{ width: 110, height: 32 }}
          />
        </View>
        <Text
          style={{
            color: "#FBE9D6",
            fontSize: 13,
            fontFamily: "Inter_500Medium",
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          Platr · Cafe operations
        </Text>
        <Text
          style={{
            color: "#FFFFFF",
            fontSize: 32,
            fontFamily: "PlayfairDisplay_700Bold",
            marginTop: 6,
            letterSpacing: -0.5,
          }}
        >
          Welcome back.
        </Text>
        <Text
          style={{
            color: "rgba(255,255,255,0.7)",
            fontSize: 15,
            marginTop: 8,
            lineHeight: 21,
            fontFamily: "Inter_400Regular",
          }}
        >
          Run your cafe from your pocket — sales, stock, and decisions in one place.
        </Text>
      </LinearGradient>

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: 24,
          paddingBottom: (isWeb ? 34 : insets.bottom) + 24,
        }}
        bottomOffset={20}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ marginTop: -28 }}>
          <View
            style={{
              backgroundColor: c.card,
              borderRadius: 22,
              padding: 18,
              borderWidth: 1,
              borderColor: c.border,
              shadowColor: "#000",
              shadowOpacity: 0.08,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 6 },
              elevation: 6,
            }}
          >
            <Field
              label="Username"
              value={username}
              onChangeText={setUsername}
              placeholder="admin"
              icon="user"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={{ height: 12 }} />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              icon="lock"
              secureTextEntry={!showPwd}
              rightIcon={showPwd ? "eye-off" : "eye"}
              onRightPress={() => setShowPwd((v) => !v)}
              onSubmitEditing={onSubmit}
            />

            {error ? (
              <View
                style={{
                  marginTop: 14,
                  backgroundColor: "#FEE2E2",
                  borderRadius: 12,
                  padding: 12,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Feather name="alert-circle" size={16} color={c.destructive} />
                <Text
                  style={{
                    color: c.destructive,
                    fontSize: 13,
                    flex: 1,
                    fontFamily: "Inter_500Medium",
                  }}
                >
                  {error}
                </Text>
              </View>
            ) : null}

            <View style={{ marginTop: 18 }}>
              <PrimaryButton
                label={busy ? "Signing in…" : "Sign in"}
                icon={busy ? undefined : "arrow-right"}
                onPress={onSubmit}
                loading={busy}
                fullWidth
              />
            </View>
          </View>

          <View
            style={{
              marginTop: 22,
              backgroundColor: c.muted,
              borderRadius: 16,
              padding: 14,
              flexDirection: "row",
              gap: 10,
              alignItems: "flex-start",
            }}
          >
            <Feather name="info" size={16} color={c.mutedForeground} />
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 13,
                  color: c.foreground,
                  fontFamily: "Inter_600SemiBold",
                }}
              >
                Demo credentials
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: c.mutedForeground,
                  marginTop: 4,
                  lineHeight: 18,
                }}
              >
                Admin — admin / admin123{"\n"}Manager — manager / manager123
              </Text>
            </View>
          </View>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  icon,
  rightIcon,
  onRightPress,
  secureTextEntry,
  autoCapitalize,
  autoCorrect,
  onSubmitEditing,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  rightIcon?: React.ComponentProps<typeof Feather>["name"];
  onRightPress?: () => void;
  secureTextEntry?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  onSubmitEditing?: () => void;
}) {
  const c = useColors();
  return (
    <View>
      <Text
        style={{
          fontSize: 12,
          color: c.mutedForeground,
          fontFamily: "Inter_600SemiBold",
          marginBottom: 6,
          letterSpacing: 0.3,
        }}
      >
        {label.toUpperCase()}
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 12,
          paddingVertical: Platform.OS === "ios" ? 14 : 8,
          backgroundColor: c.muted,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: c.border,
        }}
      >
        <Feather name={icon} size={16} color={c.mutedForeground} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={c.mutedForeground}
          secureTextEntry={secureTextEntry}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          onSubmitEditing={onSubmitEditing}
          style={[
            styles.input,
            { color: c.foreground, fontFamily: "Inter_500Medium" },
          ]}
        />
        {rightIcon ? (
          <Pressable onPress={onRightPress} hitSlop={10}>
            <Feather name={rightIcon} size={16} color={c.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
});
