import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Apply.ai — your job search, run by agents",
  description: "Upload your CV once. Apply.ai finds matching jobs on Naukri, LinkedIn and Indeed, and tailors your CV for each one.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Instrument+Serif&display=swap"
        />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
