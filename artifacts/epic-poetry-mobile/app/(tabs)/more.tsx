import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, ListRow, Pill, SectionHeader } from "@/components/UI";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

interface NavItem {
  label: string;
  icon: FeatherName;
  route: string;
  iconBg?: string;
  iconFg?: string;
}

export default function MoreScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const isWeb = Platform.OS === "web";

  const peopleItems: NavItem[] = [
    { label: "Customers", icon: "users", route: "/customers" },
    { label: "Team", icon: "user-check", route: "/employees" },
  ];
  const opsItems: NavItem[] = [
    { label: "Vendors", icon: "truck", route: "/vendors" },
    { label: "Expenses", icon: "credit-card", route: "/expenses" },
  ];
  const insightsItems: NavItem[] = [
    { label: "Insights", icon: "trending-up", route: "/insights" },
  ];

  const onSignOut = () => {
    const doSignOut = () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void signOut();
    };
    if (Platform.OS === "web") {
      doSignOut();
    } else {
      Alert.alert("Sign out", "End your session on this device?", [
        { text: "Cancel", style: "cancel" },
        { text: "Sign out", style: "destructive", onPress: doSignOut },
      ]);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{
        padding: 16,
        paddingTop: (isWeb ? 67 : insets.top) + 4,
        paddingBottom: 100 + insets.bottom,
        gap: 18,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View>
        <Text
          style={{
            fontSize: 28,
            fontFamily: "PlayfairDisplay_700Bold",
            color: c.foreground,
            letterSpacing: -0.5,
          }}
        >
          More
        </Text>
      </View>

      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: c.primary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                color: c.primaryForeground,
                fontSize: 22,
                fontFamily: "PlayfairDisplay_700Bold",
              }}
            >
              {(user?.fullName || user?.username || "?").slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={{
                fontSize: 16,
                color: c.foreground,
                fontFamily: "Inter_700Bold",
              }}
              numberOfLines={1}
            >
              {user?.fullName || user?.username || "Signed-in user"}
            </Text>
            <Text
              style={{
                fontSize: 12,
                color: c.mutedForeground,
                marginTop: 2,
              }}
            >
              @{user?.username}
            </Text>
            <View style={{ marginTop: 6 }}>
              <Pill
                label={user?.role === "admin" ? "Admin" : user?.role ?? "Member"}
                tone={user?.role === "admin" ? "primary" : "info"}
                icon={user?.role === "admin" ? "shield" : "user"}
              />
            </View>
          </View>
        </View>
      </Card>

      <NavGroup title="People" items={peopleItems} />
      <NavGroup title="Operations" items={opsItems} />
      <NavGroup title="Analysis" items={insightsItems} />

      <View>
        <SectionHeader title="Account" />
        <Card padded={false}>
          <Pressable
            onPress={onSignOut}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              padding: 14,
              backgroundColor: pressed ? c.muted : c.card,
            })}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                backgroundColor: "#FEE2E2",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Feather name="log-out" size={17} color={c.destructive} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 14,
                  color: c.destructive,
                  fontFamily: "Inter_600SemiBold",
                }}
              >
                Sign out
              </Text>
              <Text style={{ fontSize: 12, color: c.mutedForeground, marginTop: 2 }}>
                You will need to log in again next time.
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={c.mutedForeground} />
          </Pressable>
        </Card>
      </View>

      <Text
        style={{
          fontSize: 11,
          color: c.mutedForeground,
          textAlign: "center",
          marginTop: 8,
        }}
      >
        Platr · Mobile · v1.0
      </Text>
    </ScrollView>
  );
}

function NavGroup({ title, items }: { title: string; items: NavItem[] }) {
  const c = useColors();
  const router = useRouter();
  return (
    <View>
      <SectionHeader title={title} />
      <Card padded={false}>
        {items.map((item, i) => (
          <View key={item.route}>
            <ListRow
              title={item.label}
              leftIcon={item.icon}
              leftIconBg={item.iconBg}
              leftIconFg={item.iconFg}
              onPress={() => router.push(item.route as never)}
              right=" "
            />
            {i < items.length - 1 ? (
              <View
                style={{
                  height: 1,
                  backgroundColor: c.border,
                  marginLeft: 64,
                }}
              />
            ) : null}
          </View>
        ))}
      </Card>
    </View>
  );
}
