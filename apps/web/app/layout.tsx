import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BA Workbench",
  description: "AI-powered Senior Business Analyst Workbench"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
