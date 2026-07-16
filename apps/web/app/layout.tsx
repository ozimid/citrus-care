import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { RegisterSW } from "@/components/RegisterSW";
import { DevLanBanner } from "@/components/DevLanBanner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://citruscare.net"),
  title: "Citrus Care",
  description:
    "Snap a plant photo, get a scored diagnosis — AI running on your phone. No account, no cloud, free Android app.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Citrus Care — private, on-device plant care",
    description:
      "Photo-driven plant health diagnosis with AI that runs entirely on your phone. Nothing leaves the device.",
    url: "/",
    siteName: "Citrus Care",
    images: ["/landing-citrus-assessment.png"],
  },
  manifest: "/manifest.json",
  applicationName: "Citrus Care",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Runs before first paint so the correct theme (stored choice, else OS
// preference) is applied with no flash, and re-applies on live OS changes for
// every route. Kept in sync with app/_lib/theme.ts.
const themeInitScript = `(function(){function a(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement('meta');m.setAttribute('name','theme-color');document.head.appendChild(m);}m.setAttribute('content',d?'#0a0a0a':'#fef3c7');}catch(e){}}a();try{matchMedia('(prefers-color-scheme: dark)').addEventListener('change',a);}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full bg-background text-foreground flex flex-col">
        <DevLanBanner />
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
