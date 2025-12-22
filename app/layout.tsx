import type { Metadata } from "next";

// --- INSTRUÇÃO PARA SEU COMPUTADOR (VS CODE) ---
// 1. Certifique-se de ter o arquivo 'globals.css' na pasta 'app'.
// 2. Quando estiver no seu computador, DESCOMENTE a linha abaixo (apague as duas barras //).
 import "./globals.css"; 
export const metadata: Metadata = {
  title: "AutoMetrics",
  description: "Dashboard Financeiro",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // O erro "validateDOMNesting" no console DESTE CHAT é normal e esperado.
    // O Next.js EXIGE estas tags <html> e <body> no seu projeto local.
    <html lang="pt-BR">
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
        {children}
      </body>
    </html>
  );
}