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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ component: Component, adminOnly }: { component: React.ComponentType; adminOnly?: boolean }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div>;
  }

  if (!user) {
    return <Login />;
  }

  if (adminOnly && user.role !== 'admin') {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-6xl mb-4">🔒</div>
          <h2 className="text-2xl font-bold mb-2">Access Restricted</h2>
          <p className="text-muted-foreground">This page is only accessible to administrators.</p>
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
      <Route path="/" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/menu" component={() => <ProtectedRoute component={MenuItems} />} />
      <Route path="/ingredients" component={() => <ProtectedRoute component={Ingredients} />} />
      <Route path="/vendors" component={() => <ProtectedRoute component={Vendors} />} />
      <Route path="/purchases" component={() => <ProtectedRoute component={Purchases} />} />
      <Route path="/sales" component={() => <ProtectedRoute component={Sales} />} />
      <Route path="/inventory" component={() => <ProtectedRoute component={Inventory} />} />
      <Route path="/expenses" component={() => <ProtectedRoute component={Expenses} />} />
      <Route path="/waste" component={() => <ProtectedRoute component={Waste} />} />
      <Route path="/trials" component={() => <ProtectedRoute component={Trials} adminOnly />} />
      <Route path="/reports" component={() => <ProtectedRoute component={Reports} adminOnly />} />
      <Route path="/masters" component={() => <ProtectedRoute component={Masters} adminOnly />} />
      <Route path="/analytics" component={() => <ProtectedRoute component={AnalyticsPage} adminOnly />} />
      <Route path="/upload" component={() => <ProtectedRoute component={UploadPage} />} />
      <Route path="/settlements" component={() => <ProtectedRoute component={Settlements} />} />
      <Route path="/petty-cash" component={() => <ProtectedRoute component={PettyCash} />} />
      <Route path="/employees" component={() => <ProtectedRoute component={EmployeesPage} />} />
      <Route path="/attendance" component={() => <ProtectedRoute component={AttendancePage} />} />
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
