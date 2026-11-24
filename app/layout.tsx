import type { Metadata } from "next";
import { Suspense } from "react";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Visus Publish",
  description: "Planejamento, geração por IA, aprovação e publicação no Instagram.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${jakarta.variable} h-full antialiased`}>
      <body className="min-h-full font-sans text-[14px]">
        {/* Todas as telas dependem da sessão do usuário: renderizam por request. */}
        <Suspense fallback={<div aria-busy="true" className="min-h-screen bg-background" />}>{children}</Suspense>
      </body>
    </html>
  );
}
