
import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "XPLORERS | SPHEREx Mission",
  description:
    "Explore the universe with XPLORERS, an interactive SPHEREx astronomy platform.",
};

const fontVariables = {
  "--font-geist-sans": "Arial, Helvetica, sans-serif",
  "--font-geist-mono": "Consolas, monospace",
} as CSSProperties;

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      style={fontVariables}
    >
      <body className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
