import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Data Collector",
  description: "Clean and prepare CSV and Excel files",
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
