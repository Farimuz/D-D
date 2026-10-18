# D&D — Plan técnico de implementación aprobado

> **Estado posterior al plan (17-oct-2026):** PR 0 finalizado con [PR #8](https://github.com/Farimuz/D-D/pull/8); PR 1 se dividió en 1-A/1-B, con [PR #9](https://github.com/Farimuz/D-D/pull/9) (1-A) abierto como borrador, pruebas CI verdes y auditoría independiente pendiente. El estado operativo detallado consta en [el handoff](CONTEXT_HANDOFF_2026-10-17.md). PR 1-B sigue sin iniciar.

**Aprobación de planificación:** 2026-10-17 (paso 2).  
**Base de referencia inicial:** `main` en `d5ce9bbd8e72ed823ca0b764960b020d783fdf70`; estado integrado comprobado al corte del handoff: `a70014a152a0e763aed6ebdc99a226362b2891ca` (PR #8).  
**PR 0:** completado. **PR 1-A:** implementado, CI verde y revisión independiente pendiente; **PR 1-B:** no iniciado. El plan aprobado **no autoriza anticipadamente** codificar PR siguientes, fusionar ramas, publicar una versión o desplegar.  
**Criterio general:** incrementos verificables, sin romper el modo local ni las salas existentes y sin acoplar el dominio a Node/SQLite/Oracle.

## 1. Hechos comprobados y límites

- El núcleo compartido define `RoomState` con ID, `SharedBoard`, revisión y participantes; `Token` define posición, visibilidad y propietario, **no** el personaje. Ver `src/core/room/types.ts` y `src/state/model.ts`.
- El modo online tiene servidor Node HTTP/WebSocket y autorización de acciones, persistencia de salas y accesos con SQLite, imágenes en filesystem y backup/restauración. No hay cuentas, campañas independientes, hojas, dados ni encuentros completos.
- `src/infrastructure/node/sqlite/schema.ts` establece `SCHEMA_VERSION = 3`, `STRICT` y verificaciones de forma/consistencia; las extensiones requieren migraciones y adaptación de backups/restauración, con pruebas desde datos anteriores.
- `src/online/protocol.ts` ya usa `requestId` como correlación de respuesta, **no** como prueba durable de idempotencia. El cliente actual no reintenta automáticamente mutaciones inciertas.
- El servidor entrega imágenes completas del mapa; la niebla es visual, no un sistema antiextracción de detalles dibujados sobre el mapa.
- La auditoría histórica documenta **488/488 tests** correctos sobre Windows/Node 24. **No se ejecutaron pruebas en este PR documental.** Linux/ARM64/Oracle, despliegue público y seguridad de autenticación nueva están pendientes.

Fuentes: [estado del proyecto](PROJECT_STATUS.md), [arquitectura portable](architecture/portable-runtime.md), [auditoría v0.0.5](architecture/v0.0.5-final-audit.md), [decisión 0003](decisions/0003-portable-core-infrastructure-adapters.md).

## 2. Modelo de dominio y dependencias

```text
Cuenta ── posee ──> Personaje(s)
  │                   │
  └── participa en ──> Participación en campaña
                           │ selecciona un personaje activo
Campaña ── organiza ──> Mesa(s)/Sala ── contiene ──> Fichas
  │                                              │ vínculo opcional
  └── Sesiones ── Encuentros                 Personaje
           ├── Tiradas/historial
           ├── Notas y avisos
           └── Iniciativa, turnos y recursos
```

Es una guía conceptual, **no esquema SQL definitivo**. Mantener una sola fuente de verdad para HP y progresión del personaje. La ficha representa posición/visibilidad en la mesa. Una participación enlaza cuenta, campaña y personaje seleccionado. Inicialmente: un personaje activo por jugador y campaña; selección libre al aceptar invitación, sin revisión obligatoria del DM.

**Dirección de arquitectura:** dominio validado y portable, adaptadores Node para HTTP/WebSocket/SQLite/FS, almacenamiento durable antes de publicar resultados y proyecciones por rol. Los requisitos nuevos aplican al **modo Node autoritativo**. La mesa local histórica permanece operativa sin paridad inmediata.

## 3. Secuencia aprobada de PRs (orientativa, divisible)

| PR | Objetivo | Dependencia fundamental | Complejidad relativa |
| --- | --- | --- | --- |
| 0 | Documentación de acuerdos, diseño y roadmap | Ninguna | Baja |
| 1 | Nuevas entidades y migraciones durables | 0 | Alta |
| 2 | Registro invitado, cuentas, sesiones y recuperación | 1 | Alta |
| 3 | Biblioteca de personajes y hojas manuales | 2 | Media-alta |
| 4 | Campañas, invitaciones independientes y lobby | 2–3 | Media-alta |
| 5 | Vinculación de personajes con fichas y mesa | 3–4 | Alta |
| 6 | Dados universales e historial idempotente | 2, 5 para UI integrada | Alta |
| 7 | HP/recursos, sesiones y notificaciones al DM | 3, 5 | Media-alta |
| 8 | Combate manual, iniciativa, turnos, notas | 5–7 | Media |
| 9 | Integración de UX y validación extremo a extremo | 1–8 | Media-alta |

No prometer fechas ni versiones a partir de la tabla. Si un PR es demasiado grande, dividirlo por operaciones verticales pequeñas: modelo + autorización + persistencia + API/UI mínima + pruebas. La UI evoluciona con cada entrega, no se desarrolla toda al final.

### PR 0 — Documentar el producto

Actualizar continuidad, acuerdos de cuentas y selección de personajes, propuesta de pantallas jugador/DM y este roadmap. Enlazar en índice.

**Aceptación:** documentación coherente, sin afirmaciones de funcionalidad implementada, enlaces correctos, sin cambios fuera de Markdown. PR borrador para revisión, **sin merge**.

### PR 1 — Migración de datos y contratos

Diseñar relaciones de nuevas entidades, esquema versionado tras v3 y adaptadores neutrales adecuados. Planificar transacciones, concurrencia y backups; mantener invariantes de `RoomState`/salas históricas sin reescribir validadores como parche oportunista.

**Aceptación:** abrir base anterior, migrar conservando sala, mapa, credenciales y asignaciones; backups nuevos incluyen datos nuevos y se restauran. Fallo de migración no destruye datos; rechazar versión futura. No crear tablas vacías o servicios innecesarios.

### PR 2 — Cuentas seguras

Invitación administrativa de registro un uso, expiración y revocación; usuario/contraseña sin email obligatorio; login y sesiones revocables; recuperación asistida mediante código temporal. Administrador inicial = DM pero roles conceptualmente distintos.

**Aceptación:** un código gastado/revocado/expirado no puede volver a utilizarse; contraseña no se almacena legible; usuario A nunca accede a biblioteca de B; sesiones funcionan desde otro dispositivo; revocación tiene efecto; límites contra abuso y pruebas de seguridad. No habilitar despliegue a Internet público por superar solo pruebas locales.

### PR 3 — Biblioteca y hoja

Crear, editar, autoguardar y consultar múltiples personajes propios, incluidos borradores incompletos. «Listo» manual, reversible e informativo; editar no lo desmarca automáticamente. Campos manuales HP max/actual/temporal, CA, atributos, nivel, equipo, habilidades, hechizos, recursos y notas. Hoja híbrida con pestañas opcionales que no pierden datos.

**Aceptación:** un borrador vacío o parcial sobrevive salida y reinicio; dos dispositivos recuperan la misma versión confirmada; permisos de propietario en servidor; caracteres y tamaños límite validados; no sobrescritura silenciosa por concurrencia.

### PR 4 — Campañas y lobby

Separar invitación de registro e invitación de campaña. Lobby «Mis personajes» / «Mis campañas»; aceptar campaña y elegir libremente un personaje activo. El DM conoce quién participa; cuenta/hoja funcionan sin DM online si Node responde.

**Aceptación:** registrarse no une a campaña; no se usa una invitación de otra campaña; un miembro tiene solo un personaje activo; no requiere aprobación del DM; jugador ajeno no consulta secretos.

### PR 5 — Integración con tablero

Vincular identidad de cuenta, participación, personaje y ficha existente sin copiar la hoja completa dentro de la ficha. Reutilizar motor de tablero y sus permisos; introducir autorización basada en la pertenencia a campaña. Preservar códigos de salas previas hasta política de transición explícita.

**Aceptación:** PC y teléfono ven su personaje/ficha correctos; reconectar no duplica participantes ni tokens; movimiento ajeno/oculto se rechaza; no transferir credencial DM heredada por coincidencia de nombre; tablero actual pasa regresión.

**Hito 1 — entrada a la mesa:** desde una cuenta y un personaje persistente hasta una sesión de exploración compartida.

### PR 6 — Dados autoritativos

Lanzador global vacío, fórmula editable y controles bidireccionales con límites; tirada guardada opcional en arma/habilidad/hechizo. Servidor genera y guarda dados individuales, modificadores y total. Usar **idempotencia durable** con ID lógico de operación, hash/concordancia de payload y confirmación transaccional de recibo/resultado. Mismo ID y payload => mismo resultado; mismo ID con payload distinto => rechazo.

**Aceptación:** interrupción después del commit no crea otra tirada al repetir; resultado persiste tras reinicio; no se acepta fórmula arbitraria fuera de gramática/límites; permiso y visibilidad validados en servidor. No daño automático ni bonos persistentes.

### PR 7 — Vida, recursos y ciclo de sesión

Una fuente de HP y recursos, modificación por DM o propietario, daño/curación por cantidad, HP temporal separado, alertas discretas al DM durante sesión activa (no por simple edición fuera de ella). Pausar una sesión no reinicia datos.

**Aceptación:** cambios concurrentes no pierden valores; permisos se verifican en cada mutación; historia de actor/antes/después según relevancia; reanudar conserva recursos y estado de sesión.

### PR 8 — Combate asistido

Encuentro activo, iniciativa, ronda, turno y condiciones manuales. Solo DM modifica enemigos inicialmente. Notas privadas DM y compartidas con proyección por rol.

**Aceptación:** pausar en mitad de ronda, reiniciar Node y continuar en mismo estado; jugadores ven solo datos autorizados; el sistema no aplica automáticamente daño al tirar dados.

**Hito 2 — sesión jugable:** explorar, tirar, resolver un combate manual, terminar y reanudar sin pérdida de progreso.

### PR 9 — UX y flujo integrado

Pulir panel lateral PC, bandeja táctil móvil, accesibilidad, estados de red, navegación entre hoja/tablero/iniciativa y presentación del historial. La UI no debe prometer confirmación antes de persistir.

**Aceptación:** recorrido extremo a extremo con DM + dos jugadores (PC y teléfono), creación y vinculación de cuentas/personajes, campaña, exploración, combate, dado, desconexión/reconexión, reinicio y continuación. Probar Safari/Android reales cuando sea posible; emulación no equivale a dispositivo físico.

## 4. Política de pruebas y calidad por entrega

- Ejecutar pruebas relevantes y regresión completa cuando cambien contratos, permisos, persistencia o protocolo. La base histórica de 488 pruebas es **evidencia pasada**, no resultado de una ejecución nueva.
- Pruebas negativas: usuario distinto, miembro revocado, ficha ajena, secreto del DM, invitación reutilizada, requests alterados y concurrencia.
- Fallos: DB ocupada/llena, caída entre escritura y confirmación, backup/restauración, apagado y lectura de esquemas antiguos.
- Mantener core portable sin dependencias de Node, FS, SQLite, React, reloj ni red. Cloudflare futuro no exige adaptar ahora el runtime.
- Revisar cada diff y ejecutar auditorías destructivas proporcionales al riesgo antes de proponer merge.
- No hacer cambios o despliegues en Oracle/Hermes ni usar recursos de otros proyectos sin autorización explícita.
- La publicación pública requiere aparte HTTPS/WSS, endurecimiento de cuentas/sesiones, privacidad, recuperación y pruebas Linux/ARM64.

## 5. Riesgos y puntos abiertos

| Riesgo | Plan de control |
| --- | --- |
| Romper formato estricto v3 | Migración separada, versión nueva, no reescritura silenciosa, pruebas de base vieja |
| Filtrar datos de usuario/DM | Proyecciones whitelist y pruebas de lectura/acciones no autorizadas |
| Perder contraseña o sesión | Recuperación administrativa sin revelar secretos; controlar revocación |
| Duplicar tirada | Dedupe durable por ID lógico + payload, no confiar en `requestId` |
| Duplicar HP en hoja y encuentro | Una referencia estable / una fuente de verdad |
| Cambios concurrentes | Transacciones y detección de conflictos, no guardado de objetos obsoletos |
| Móvil incómodo | Prototipo y pruebas táctiles por hito, no solo captura estática |
| Despliegue prematuro | No exponer versión experimental; pruebas de seguridad y host aislado |

**No cerrados por PR 0:** selección de versión 2014/2024; política para cambiar personaje durante campaña; visibilidad de tiradas públicas/privadas; detalles de sesiones y notas; recuperación de administrador; semántica final de hojas y recursos; transición de salas heredadas; UX móvil real.

## 6. Reglas de autorización

Este documento conserva un plan **aprobado** pero no sustituye la aprobación de cada trabajo concreto. La autorización del PR 0 fue para crear **rama documental y PR de revisión**, sin integrar `main` ni tocar despliegues. Cualquier modificación del código, nuevo PR de implementación, merge o despliegue requiere permiso expreso posterior.
