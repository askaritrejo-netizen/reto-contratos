import type { ProveedorLLM } from "./adapter"
import { anthropicProveedor } from "./anthropic"

/** Único punto donde se elige el proveedor. */
export const proveedor: ProveedorLLM = anthropicProveedor
