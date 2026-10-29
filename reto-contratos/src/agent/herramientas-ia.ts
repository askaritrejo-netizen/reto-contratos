import { tool, type ToolSet } from "ai"
import { z } from "zod"
import { alertas, extraer, leer_buzon, registrar, validar, type Contexto } from "../tools/contratos"

const aObjeto = (s: string): unknown => JSON.parse(s) as unknown

/**
 * Conecta las herramientas (src/tools/contratos.ts) con el SDK de IA.
 * La lógica NO se duplica: aquí solo se envuelven.
 * contratos_registrar tiene needsApproval: el SDK no la ejecuta hasta que la
 * persona pulsa "Confirmar" en el chat. Esa aprobación ES la confirmación
 * humana, por eso al ejecutarse se envía confirmado = true.
 */
export function herramientasIA(ctx: Contexto): ToolSet {
  return {
    contratos_leer_buzon: tool({
      description: leer_buzon.description,
      inputSchema: z.object(leer_buzon.args),
      execute: async (args) => aObjeto(await leer_buzon.execute(args, ctx)),
    }),
    contratos_extraer: tool({
      description: extraer.description,
      inputSchema: z.object(extraer.args),
      execute: async (args) => aObjeto(await extraer.execute(args, ctx)),
    }),
    contratos_validar: tool({
      description: validar.description,
      inputSchema: z.object(validar.args),
      execute: async (args) => aObjeto(await validar.execute(args, ctx)),
    }),
    contratos_registrar: tool({
      description: registrar.description,
      inputSchema: z.object(registrar.args).omit({ confirmado: true }),
      needsApproval: true,
      execute: async (args) => aObjeto(await registrar.execute({ ...args, confirmado: true }, ctx)),
    }),
    contratos_alertas: tool({
      description: alertas.description,
      inputSchema: z.object(alertas.args),
      execute: async (args) => aObjeto(await alertas.execute(args, ctx)),
    }),
  }
}
