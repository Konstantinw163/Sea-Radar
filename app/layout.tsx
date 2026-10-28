import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sea Radar",
  description: "Карта и демонстрационные суда пролива Дувр",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
