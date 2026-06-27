import type { Metadata, Viewport } from "next";
import { Sora, Inter } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";
import DemoBanner from "@/components/layout/DemoBanner";
import RouteProgress from "@/components/ui/RouteProgress";
import WelcomeOverlay from "@/components/ui/WelcomeOverlay";
import LogoutFlow from "@/components/ui/LogoutFlow";

const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-sora",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Naman Sharma IAS Academy — Crack UPSC the Right Way",
  description:
    "Chandigarh's most personal UPSC academy. Foundation, Optionals, Test Series & Mentorship — Online, Offline & Hybrid. Daily current affairs, MCQs, PYQs and live classes by Naman Sir.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0057FF",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${inter.variable}`}>
      <body>
        <ToastProvider>
          <RouteProgress />
          <DemoBanner />
          {children}
          <WelcomeOverlay />
          <LogoutFlow />
        </ToastProvider>
      </body>
    </html>
  );
}
