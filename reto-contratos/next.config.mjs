/** @type {import('next').NextConfig} */
const incluir = ["./fixtures/**/*", "./agent/**/*", "./src/knowledge/**/*"]

const nextConfig = {
  // Copia los fixtures, el prompt y el conocimiento junto al servidor en Vercel.
  // (Además existe la copia empaquetada en src/generated/archivos.ts como respaldo.)
  outputFileTracingIncludes: {
    "/*": incluir,
    "/api/*": incluir,
    "/api/chat": incluir,
    "/api/archivos": incluir,
  },
  // La verificación de tipos se hace con `npm run typecheck`; no se bloquea el despliegue por ella.
  typescript: { ignoreBuildErrors: true },
}

export default nextConfig
