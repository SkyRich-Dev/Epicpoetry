import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React from "react";
import {
  Platform,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Card,
  EmptyState,
  ErrorState,
  HeroBanner,
  ListRow,
  LoadingState,
  MetricCard,
  Pill,
  SectionHeader,
} from "@/components/UI";
import { useColors } from "@/hooks/useColors";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  daysAgoISO,
  formatCurrency,
  formatNumber,
  formatRelative,
  formatTime,
  todayISO,
} from "@/lib/format";

interface SalesInvoiceSummary {
  id: number;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  totalAmount?: number | string | null;
  netAmount?: number | string | null;
  customerName?: string | null;
  source?: string | null;
  paymentMode?: string | null;
  createdAt?: string | null;
}

interface DashboardSummary {
  todayRevenue?: number;
  todayInvoices?: number;
  avgTicket?: number;
  monthRevenue?: number;
  weekRevenue?: number;
  topItem?: { name: string; revenue: number } | null;
  lowStockCount?: number;
}

export default function HomeScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isWeb = Platform.OS === "web";

  const summaryQ = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: async () => api.get<DashboardSummary>("/dashboard/summary"),
  });

  const recentQ = useQuery({
    queryKey: ["recent-invoices"],
    queryFn: async () => {
      const from = daysAgoISO(2);
      const to = todayISO();
      const res = await api.get<SalesInvoiceSummary[] | { items: SalesInvoiceSummary[] }>(
        `/sales-invoices?fromDate=${from}&toDate=${to}&limit=6`,
      );
      const items = Array.isArray(res) ? res : (res?.items ?? []);
      return items.slice(0, 6);
    },
  });

  const lowStockQ = useQuery({
    queryKey: ["low-stock"],
    queryFn: async () => {
      try {
        const res = await api.get<unknown>("/inventory/low-stock");
        if (Array.isArray(res)) return res as { ingredientName?: string; name?: string; currentStock?: number; minStock?: number; uom?: string }[];
        return [] as { ingredientName?: string; name?: string; currentStock?: number; minStock?: number; uom?: string }[];
      } catch {
        return [];
      }
    },
  });

  const refreshing =
    summaryQ.isFetching || recentQ.isFetching || lowStockQ.isFetching;

  const onRefresh = () => {
    summaryQ.refetch();
    recentQ.refetch();
    lowStockQ.refetch();
  };

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  const summary = summaryQ.data ?? {};

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{
        padding: 16,
        paddingTop: (isWeb ? 67 : insets.top) + 4,
        paddingBottom: 100 + insets.bottom,
        gap: 18,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={c.primary}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      <HeroBanner
        greeting={greeting}
        name={user?.fullName || user?.username || "there"}
        subtitle={`Here is how the cafe is doing today, ${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}.`}
      />

      {summaryQ.isLoading ? (
        <LoadingState label="Loading today's numbers" />
      ) : summaryQ.isError ? (
        <ErrorState
          message={(summaryQ.error as Error)?.message ?? "Could not load dashboard"}
          onRetry={() => summaryQ.refetch()}
        />
      ) : (
        <>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <MetricCard
              label="Today revenue"
              value={formatCurrency(summary.todayRevenue ?? 0)}
              hint={`${formatNumber(summary.todayInvoices ?? 0)} invoices`}
              icon="trending-up"
              tone="primary"
            />
            <MetricCard
              label="Avg ticket"
              value={formatCurrency(summary.avgTicket ?? 0)}
              hint="Per invoice"
              icon="receipt"
              tone="info"
            />
          </View>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <MetricCard
              label="This week"
              value={formatCurrency(summary.weekRevenue ?? 0)}
              hint="7-day revenue"
              icon="bar-chart-2"
              tone="success"
            />
            <MetricCard
              label="Low stock"
              value={formatNumber(lowStockQ.data?.length ?? summary.lowStockCount ?? 0)}
              hint="items to reorder"
              icon="alert-triangle"
              tone="warning"
            />
          </View>
        </>
      )}

      <View>
        <SectionHeader
          title="Recent invoices"
          action="See all"
          onAction={() => router.push("/(tabs)/sales")}
        />
        <Card padded={false}>
          {recentQ.isLoading ? (
            <LoadingState />
          ) : recentQ.isError ? (
            <ErrorState
              message="Could not load invoices"
              onRetry={() => recentQ.refetch()}
            />
          ) : !recentQ.data || recentQ.data.length === 0 ? (
            <EmptyState
              icon="file-text"
              title="No invoices yet"
              message="Invoices from Petpooja or manual entries will appear here."
            />
          ) : (
            recentQ.data.map((inv, i) => (
              <View key={inv.id}>
                <ListRow
                  title={inv.invoiceNumber || `Invoice #${inv.id}`}
                  subtitle={`${inv.customerName ?? "Walk-in"} · ${
                    inv.source ?? "manual"
                  } · ${formatTime(inv.createdAt ?? inv.invoiceDate)}`}
                  right={formatCurrency(inv.netAmount ?? inv.totalAmount ?? 0)}
                  rightSub={formatRelative(inv.createdAt ?? inv.invoiceDate)}
                  rightTone="primary"
                  leftIcon="file-text"
                  onPress={() => router.push(`/sale/${inv.id}`)}
                />
                {i < (recentQ.data?.length ?? 0) - 1 ? (
                  <View
                    style={{
                      height: 1,
                      backgroundColor: c.border,
                      marginLeft: 64,
                    }}
                  />
                ) : null}
              </View>
            ))
          )}
        </Card>
      </View>

      {lowStockQ.data && lowStockQ.data.length > 0 ? (
        <View>
          <SectionHeader
            title="Stock alerts"
            action="View stock"
            onAction={() => router.push("/(tabs)/inventory")}
          />
          <Card padded={false}>
            {lowStockQ.data.slice(0, 5).map((item, i) => {
              const name = item.ingredientName ?? item.name ?? "Ingredient";
              const cur = Number(item.currentStock ?? 0);
              const min = Number(item.minStock ?? 0);
              return (
                <View key={`${name}-${i}`}>
                  <ListRow
                    title={name}
                    subtitle={`Below threshold of ${formatNumber(min)} ${item.uom ?? ""}`.trim()}
                    leftIcon="alert-triangle"
                    leftIconBg={c.warningSoft}
                    leftIconFg={c.warning}
                    right={`${formatNumber(cur)} ${item.uom ?? ""}`.trim()}
                    rightTone={cur <= 0 ? "danger" : "neutral"}
                  />
                  {i < Math.min(lowStockQ.data!.length, 5) - 1 ? (
                    <View
                      style={{
                        height: 1,
                        backgroundColor: c.border,
                        marginLeft: 64,
                      }}
                    />
                  ) : null}
                </View>
              );
            })}
          </Card>
        </View>
      ) : null}

      <View>
        <SectionHeader title="Quick actions" />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {[
            { label: "Decisions", icon: "compass" as const, route: "/(tabs)/decision", tone: "primary" as const },
            { label: "Insights", icon: "trending-up" as const, route: "/insights", tone: "info" as const },
            { label: "Stock", icon: "box" as const, route: "/(tabs)/inventory", tone: "warning" as const },
            { label: "Vendors", icon: "truck" as const, route: "/vendors", tone: "info" as const },
            { label: "Customers", icon: "users" as const, route: "/customers", tone: "success" as const },
            { label: "Team", icon: "user-check" as const, route: "/employees", tone: "primary" as const },
          ].map((q) => (
            <View key={q.label} style={{ width: "31.5%" }}>
              <Card style={{ paddingVertical: 14, paddingHorizontal: 10, alignItems: "center" }}>
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    backgroundColor:
                      q.tone === "primary"
                        ? c.primarySoft
                        : q.tone === "info"
                          ? c.infoSoft
                          : q.tone === "success"
                            ? c.successSoft
                            : c.warningSoft,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Feather
                    name={q.icon}
                    size={18}
                    color={
                      q.tone === "primary"
                        ? c.primary
                        : q.tone === "info"
                          ? c.info
                          : q.tone === "success"
                            ? c.success
                            : c.warning
                    }
                  />
                </View>
                <Text
                  onPress={() => router.push(q.route as never)}
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: c.foreground,
                    fontFamily: "Inter_600SemiBold",
                  }}
                >
                  {q.label}
                </Text>
              </Card>
            </View>
          ))}
        </View>
      </View>

      <View
        style={{
          flexDirection: "row",
          gap: 8,
          alignItems: "center",
          justifyContent: "center",
          marginTop: 4,
        }}
      >
        <Pill label={`Signed in as ${user?.role ?? "guest"}`} tone="neutral" icon="user" />
      </View>
    </ScrollView>
  );
}
