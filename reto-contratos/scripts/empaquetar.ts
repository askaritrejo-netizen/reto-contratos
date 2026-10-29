/**
 * Copia el contenido de fixtures/, agent/prompt.md y src/knowledge/ dentro de
 * src/generated/archivos.ts. Así el servidor en la nube los tiene aunque no
 * copie esas carpetas. Se ejecuta solo antes de cada build (npm run build).
 * Los archivos originales siguen siendo la única fuente: este es un derivado.
 */
import fs from "node:fs"
import path from "node:path"

const raiz = process.cwd()
const carpetas = ["fixtures", "agent", "src/knowledge"]

function recorrer(relativa: string, salida: Record<string, string>): void {
  const absoluta = path.join(raiz, relativa)
  if (!fs.existsSync(absoluta)) return
  for (const entrada of fs.readdirSync(absoluta, { withFileTypes: true })) {
    const hija = `${relativa}/${entrada.name}`
    if (entrada.isDirectory()) recorrer(hija, salida)
    else salida[hija] = fs.readFileSync(path.join(raiz, hija), "utf8")
  }
}

const archivos: Record<string, string> = {}
for (const c of carpetas) recorrer(c, archivos)

const contenido =
  "// Archivo generado por scripts/empaquetar.ts. No editar a mano.\n" +
  `export const ARCHIVOS: Record<string, string> = ${JSON.stringify(archivos, null, 2)}\n`

fs.mkdirSync(path.join(raiz, "src/generated"), { recursive: true })
fs.writeFileSync(path.join(raiz, "src/generated/archivos.ts"), contenido)
console.log(`Empaquetados ${Object.keys(archivos).length} archivos en src/generated/archivos.ts`)

// ---- Bonus: módulo reutilizable (modulo/) generado desde las mismas fuentes ----
const prompt = archivos["agent/prompt.md"] ?? ""
const conocimiento = archivos["src/knowledge/registro-contratos.md"] ?? ""
const agente = [
  "---",
  "description: Agente de registro de contratos vigentes (clasifica, extrae, valida, registra con confirmación humana y alerta vencimientos)",
  "mode: primary",
  "permission:",
  "  edit: deny",
  "  bash: deny",
  "---",
  "",
  prompt,
].join("\n")
const skill = [
  "---",
  "name: registro-contratos",
  "description: Reglas de negocio y conocimiento del proceso de registro de contratos vigentes de Periferia (RN1-RN6, pólizas, archivo y alertas)",
  "---",
  "",
  conocimiento,
].join("\n")
fs.mkdirSync(path.join(raiz, "modulo/skill/registro-contratos"), { recursive: true })
fs.writeFileSync(path.join(raiz, "modulo/agent.md"), agente)
fs.writeFileSync(path.join(raiz, "modulo/skill/registro-contratos/SKILL.md"), skill)
console.log("Módulo reutilizable actualizado en modulo/")
