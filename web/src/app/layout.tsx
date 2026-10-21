import type { Metadata } from "next";
import "./globals.css";
import AuthLinkErrors from "@/components/AuthLinkErrors";

export const metadata: Metadata = {
  title: "Apply.ai: job hunting, minus the doomscrolling",
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
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&display=swap"
        />
      </head>
      <body className="min-h-screen">
        <AuthLinkErrors />
        {children}
      </body>
    </html>
  );
}
