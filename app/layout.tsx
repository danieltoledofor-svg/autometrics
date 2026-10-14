import type { Metadata, Viewport } from "next";

// --- INSTRUÇÃO PARA SEU COMPUTADOR (VS CODE) ---
// 1. Certifique-se de ter o arquivo 'globals.css' na pasta 'app'.
// 2. Quando estiver no seu computador, DESCOMENTE a linha abaixo (apague as duas barras //).
 import "./globals.css"; 
import SaleAlerts from "./components/SaleAlerts";
export const metadata: Metadata = {
  title: "AutoMetrics",
  description: "Dashboard Financeiro",
};

// viewport-fit=cover: o iPhone passa a informar a área segura (barra de baixo,
// recorte da câmera) pelo env(safe-area-inset-*). Os menus de baixo usam isso;
// as laterais ficam protegidas pelo padding do body em globals.css.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // O erro "validateDOMNesting" no console DESTE CHAT é normal e esperado.
    // O Next.js EXIGE estas tags <html> e <body> no seu projeto local.
    // suppressHydrationWarning: o script abaixo ajusta data-theme antes do React
    // hidratar, então o atributo diverge do HTML do servidor por definição.
    <html lang="pt-BR" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Estilos embutidos para garantir que o Fundo Preto funcione aqui no preview 
            sem precisar do arquivo externo globals.css */}
        <style dangerouslySetInnerHTML={{__html: `
          html, body {
            background-color: #000000 !important;
            color: #ffffff !important;
            margin: 0;
            padding: 0;
            min-height: 100vh;
            font-family: ui-sans-serif, system-ui, sans-serif;
          }
        `}} />
      </head>
      <body className="bg-black text-white font-sans antialiased selection:bg-indigo-500 selection:text-white min-h-screen">
        {/* Aplica o tema antes da hidratação: evita um flash claro e garante que
            os controles nativos já nasçam com o color-scheme certo. */}
        <script dangerouslySetInnerHTML={{__html: `
          try {
            document.documentElement.dataset.theme =
              localStorage.getItem('autometrics_theme') === 'light' ? 'light' : 'dark';
          } catch (e) {}
        `}} />
        {children}
        {/* Aviso de venda em qualquer tela */}
        <SaleAlerts />
      </body>
    </html>
  );
}