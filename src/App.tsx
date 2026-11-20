import { Outlet, Route, Routes } from "react-router";
import AuthLayout from "@/components/AuthLayout";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import NotFound from "@/pages/NotFound";
import DashboardPage from "@/pages/DashboardPage";
import IntakePage from "@/pages/IntakePage";
import CasesPage from "@/pages/CasesPage";
import DocumentsPage from "@/pages/DocumentsPage";
import CallsPage from "@/pages/CallsPage";
import LearningPage from "@/pages/LearningPage";
import AdminPage from "@/pages/AdminPage";
import FcbaPage from "@/pages/FcbaPage";
import RepoPage from "@/pages/RepoPage";

function PortalLayout() {
  return <AuthLayout><Outlet /></AuthLayout>;
}

export default function App() {
  return <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/login" element={<Login />} />
    <Route path="/portal" element={<PortalLayout />}>
      <Route index element={<DashboardPage />} />
      <Route path="intake" element={<IntakePage />} />
      <Route path="cases" element={<CasesPage />} />
      <Route path="documents" element={<DocumentsPage />} />
      <Route path="calls" element={<CallsPage />} />
      <Route path="learn" element={<LearningPage />} />
      <Route path="admin" element={<AdminPage />} />
      <Route path="billing-error" element={<FcbaPage />} />
      <Route path="repossession" element={<RepoPage />} />
    </Route>
    <Route path="*" element={<NotFound />} />
  </Routes>;
}
