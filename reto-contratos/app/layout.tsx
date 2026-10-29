import type { ReactNode } from "react"
import "./globals.css"

export const metadata = {
  title: "Registro de Contratos",
  description: "Agente de registro de contratos vigentes — Reto 2 Periferia IT Group",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
