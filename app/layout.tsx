import type { Metadata } from "next";
import { AppShell } from "../components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "HEG Scheduler",
  description: "Read-only datavisning for Scheduler v2"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="da">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
