import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BA Clarity",
  description: "Evidence-led business analysis, from source to stakeholder review"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
