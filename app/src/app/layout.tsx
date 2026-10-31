import type { Metadata } from "next";
import { Geist_Mono, Gloock, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import ColorLab from "@/components/dev/ColorLab";

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
});

// Display face, used for the wordmark only.
const gloock = Gloock({
  variable: "--font-gloock",
  weight: "400",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Splyce",
  description: "Bookkeeping for short-term-rental villas",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${hanken.variable} ${gloock.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {process.env.NODE_ENV === "development" && <ColorLab />}
      </body>
    </html>
  );
}
