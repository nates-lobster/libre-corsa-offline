import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { withBasePath } from "@/lib/base-path";
import { FORWARD_TO_GAME } from "@/lib/home/forward-to-game";
import { I18nProvider } from "@/i18n/I18nProvider";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from "@/lib/site";

const geist = localFont({
  src: "./fonts/geist-variable.woff2",
  weight: "100 900",
  variable: "--font-geist",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/geist-mono-variable.woff2",
  weight: "100 900",
  variable: "--font-geist-mono",
  display: "swap",
});

const chakraPetch = localFont({
  src: [
    { path: "./fonts/chakra-petch-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/chakra-petch-600-italic.woff2", weight: "600", style: "italic" },
    { path: "./fonts/chakra-petch-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./fonts/chakra-petch-700-italic.woff2", weight: "700", style: "italic" },
  ],
  variable: "--font-chakra",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: SITE_TITLE, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  category: "games",
  icons: {
    icon: [
      { url: withBasePath("/favicon.ico"), sizes: "16x16 32x32 48x48" },
      { url: withBasePath("/branding/favicon-32.png"), sizes: "32x32", type: "image/png" },
      { url: withBasePath("/branding/favicon-16.png"), sizes: "16x16", type: "image/png" },
      { url: withBasePath("/branding/librecorsa-mark.svg"), type: "image/svg+xml" },
    ],
    apple: [{ url: withBasePath("/branding/apple-touch-icon.png"), sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#08090D",
  colorScheme: "dark",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${geist.variable} ${geistMono.variable} ${chakraPetch.variable}`}
    >
      <body className="bg-lc-void text-lc-chalk antialiased">
        <script dangerouslySetInnerHTML={{ __html: FORWARD_TO_GAME }} />
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
