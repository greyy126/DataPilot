import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DataPilot",
  description: "Clean and prepare CSV and Excel files",
  icons: {
    icon: "/favicon-datapilot.png",
    shortcut: "/favicon-datapilot.png",
    apple: "/favicon-datapilot.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
