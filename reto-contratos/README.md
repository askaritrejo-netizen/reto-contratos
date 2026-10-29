# Reto 2 — Agente "Registro de Contratos Vigentes"

Agente conversacional que recibe los contratos del buzón único, extrae sus datos con nivel de confianza, detecta duplicados y actualizaciones, registra en el maestro de SharePoint (simulado) **solo con confirmación humana**, archiva el documento y genera alertas de vencimiento.

- **Link de prueba:** `https://<tu-proyecto>.vercel.app` (sin clave de acceso)
- **Documentación de la solución:** [SOLUCION.md](SOLUCION.md)

## Ejecutar en local (un comando)

```bash
cp .env.example .env.local      # y pega tu ANTHROPIC_API_KEY
npm install && npm run dev      # abre http://localhost:3000
```

Con Bun: `bun install && bun run dev`.

## Verificación sin modelo (demo.ts)

No necesita ninguna clave:

```bash
npm install && npm run demo     # o: bun install && bun run demo.ts
```

Procesa los 6 mensajes, deja `msg-006` sin registrar en la primera pasada y lo registra en una segunda llamada con `confirmado: true`. La salida queda en `out/` (se limpia al inicio).

| Mensaje | Resultado |
|---|---|
| msg-001 | nuevo → registrado, póliza `pendiente` |
| msg-002 | nuevo → registrado, `no_aplica` |
| msg-003 | actualización de CT-2026-011 (valor, fecha fin, póliza a ampliar) + historial |
| msg-004 | duplicado de CT-2026-012 → sin escritura |
| msg-005 | rechazado (cotización) |
| msg-006 | nuevo con revisión de `valor` y `fecha_fin` → registrado tras confirmar |

## Variables de entorno

| Variable | Obligatoria | Uso |
|---|---|---|
| `ANTHROPIC_API_KEY` | Sí (solo para el chat) | Clave del modelo. Solo vive en el servidor. |
| `ANTHROPIC_MODEL` | No | Por defecto `claude-haiku-5-5`. |
| `MAX_PASOS` | No | Tope de llamadas herramienta→modelo por turno (25). |
| `MAX_TOKENS_SESION` | No | Tope aproximado de tokens por conversación (90000). |
| `MAX_TOKENS_RESPUESTA` | No | Tope de tokens por respuesta (4096). |

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | Cuerpo `{ id, messages }` (formato AI SDK). Respuesta en *stream* con texto, llamadas a herramientas y solicitudes de confirmación. |
| `GET` | `/api/sessions/:id` | Historial guardado de una sesión. |
| `GET` | `/api/health` | `{ ok, provider, model, clave_configurada }` (nunca expone la clave). |
| `GET` | `/api/archivos?nombre=maestro\|alertas\|historial\|log\|procesados` | Ver el SharePoint simulado. |
| `POST` | `/api/reiniciar` | Vuelve el SharePoint simulado a su estado inicial. |

## Estructura

```
agent/prompt.md              comportamiento (system prompt)
src/knowledge/               conocimiento del proceso
src/tools/contratos.ts       herramientas tipadas con zod (ejecución)
src/lib/                     extracción por reglas, maestro CSV, lectura de fixtures
src/llm/                     adaptador del proveedor de IA (adapter.ts + anthropic.ts)
src/agent/                   conexión herramientas↔SDK, instrucciones, sesiones
app/api/                     servidor (ciclo del agente)
app/page.tsx                 chat web
demo.ts                      verificación sin modelo
modulo/                      bonus: agente empaquetado reutilizable
fixtures/                    insumos del reto (solo lectura)
```
