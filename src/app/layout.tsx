import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "mdforest - Git History, Reimagined",
  description: "Visualize Git commit history as an interactive tree with Markdown documents",
  manifest: "/manifest.json",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <meta name="theme-color" content="#18181b" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="application-name" content="mdforest" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="mdforest" />
      </head>
      <body className={`${inter.className} h-full antialiased`}>
        {children}
      </body>
    </html>
  );
}
