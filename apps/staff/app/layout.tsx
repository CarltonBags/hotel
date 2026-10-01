import type { Metadata } from "next";
import { cookies } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ACCENTS, isAccentId, isLanguage, isTheme } from "@hoteloftware/domain";
import { ACCENT_COOKIE, LANGUAGE_COOKIE, THEME_COOKIE } from "@/lib/shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hoteloftware",
};

/**
 * Theme, accent and language are mirrored into cookies at sign-in and on every
 * change, so the first paint already matches the user's settings.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const theme = jar.get(THEME_COOKIE)?.value ?? "system";
  const accentId = jar.get(ACCENT_COOKIE)?.value ?? "ocean";
  const language = jar.get(LANGUAGE_COOKIE)?.value ?? "en";
  const accent = ACCENTS[isAccentId(accentId) ? accentId : "ocean"];
  const dataTheme = isTheme(theme) && theme !== "system" ? theme : undefined;
  const style = { "--accent-light": accent.light, "--accent-dark": accent.dark };
  return (
    <html
      lang={isLanguage(language) ? language : "en"}
      data-theme={dataTheme}
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      style={style as React.CSSProperties}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
