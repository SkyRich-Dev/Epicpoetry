import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "./lib/auth";
import { Layout } from "./components/layout";

// Pages
import NotFound from "@/pages/not-found";
import Login from "./pages/login";
import Dashboard from "./pages/dashboard";
import MenuItems from "./pages/menu-items";
import Ingredients from "./pages/ingredients";
import Vendors from "./pages/vendors";
import Purchases from "./pages/purchases";
import Sales from "./pages/sales";
import Inventory from "./pages/inventory";
import Expenses from "./pages/expenses";
import Waste from "./pages/waste";
import Trials from "./pages/trials";
import Reports from "./pages/reports";
import Masters from "./pages/masters";
import UploadPage from "./pages/upload";
import AnalyticsPage from "./pages/analytics";
import Settlements from "./pages/settlements";
import PettyCash from "./pages/petty-cash";
import EmployeesPage from "./pages/employees";
import AttendancePage from "./pages/attendance";
import VendorDetailPage from "./pages/vendor-detail";
import CustomersPage from "./pages/customers";
import InsightsPage from "./pages/insights";
import DecisionPage from "./pages/decision";
import Celebrations from "./pages/celebrations";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ component: Component, requires }: { component: React.ComponentType; requires?: string }) {
  const { user, isLoading, hasPerm } = useAuth();

  if (isLoading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div>;
  }

  if (!user) {
    return <Login />;
  }

  if (requires && !hasPerm(requires)) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-6xl mb-4">🔒</div>
          <h2 className="text-2xl font-bold mb-2">Access Restricted</h2>
          <p className="text-muted-foreground">You don't have permission to view this page.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <ProtectedRoute component={Dashboard} requires="dashboard.view" />} />
      <Route path="/menu" component={() => <ProtectedRoute component={MenuItems} requires="menu_items.view" />} />
      <Route path="/ingredients" component={() => <ProtectedRoute component={Ingredients} requires="ingredients.view" />} />
      <Route path="/vendors" component={() => <ProtectedRoute component={Vendors} requires="vendors.view" />} />
      <Route path="/purchases" component={() => <ProtectedRoute component={Purchases} requires="purchases.view" />} />
      <Route path="/sales" component={() => <ProtectedRoute component={Sales} requires="sales.view" />} />
      <Route path="/inventory" component={() => <ProtectedRoute component={Inventory} requires="inventory.view" />} />
      <Route path="/expenses" component={() => <ProtectedRoute component={Expenses} requires="expenses.view" />} />
      <Route path="/waste" component={() => <ProtectedRoute component={Waste} requires="waste.view" />} />
      <Route path="/trials" component={() => <ProtectedRoute component={Trials} requires="menu_items.edit" />} />
      <Route path="/reports" component={() => <ProtectedRoute component={Reports} requires="reports.view" />} />
      <Route path="/masters" component={() => <ProtectedRoute component={Masters} requires="roles.view" />} />
      <Route path="/analytics" component={() => <ProtectedRoute component={AnalyticsPage} requires="reports.view" />} />
      <Route path="/upload" component={() => <ProtectedRoute component={UploadPage} />} />
      <Route path="/settlements" component={() => <ProtectedRoute component={Settlements} requires="settlements.view" />} />
      <Route path="/petty-cash" component={() => <ProtectedRoute component={PettyCash} requires="petty_cash.view" />} />
      <Route path="/employees" component={() => <ProtectedRoute component={EmployeesPage} requires="employees.view" />} />
      <Route path="/attendance" component={() => <ProtectedRoute component={AttendancePage} requires="attendance.view" />} />
      <Route path="/vendors/:id" component={() => <ProtectedRoute component={VendorDetailPage} requires="vendors.view" />} />
      <Route path="/customers" component={() => <ProtectedRoute component={CustomersPage} requires="customers.view" />} />
      <Route path="/insights" component={() => <ProtectedRoute component={InsightsPage} requires="insights.view" />} />
      <Route path="/decision" component={() => <ProtectedRoute component={DecisionPage} requires="decision_engine.view" />} />
      <Route path="/celebrations" component={() => <ProtectedRoute component={Celebrations} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
