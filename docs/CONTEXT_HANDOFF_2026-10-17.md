# D&D — Entrega de contexto para continuar en otro chat (PR 1-A)

> **Corte verificado:** 2026-10-17. **Objetivo:** reanudar trabajo sin depender de la conversación original, después de errores de visualización «No se pudo cargar esta respuesta» en ChatGPT.
>
> **Orden de fuentes:** verificar primero GitHub en vivo; este documento es una fotografía. En caso de conflicto, prevalecen código, diff, resultados CI actuales y decisiones posteriores autorizadas. No asumir que abrir un nuevo chat constituye autorización de implementación ni de merge.

## 0. RESUMEN DE REANUDACIÓN — LEER PRIMERO

**Repositorio:** [Farimuz/D-D](https://github.com/Farimuz/D-D)  
**Estado canónico integrado:** [`main`](https://github.com/Farimuz/D-D/tree/main) = `a70014a152a0e763aed6ebdc99a226362b2891ca` (PR #8, integración del PR 0 documental).  
**Trabajo en curso:** [PR #9](https://github.com/Farimuz/D-D/pull/9) = **PR 1-A**, rama `feat/pr1a-backup-schema-compat`, HEAD verificado `1b1a0395f225f9a784cd72d4ed47f17c34cbca5d`.  
**PR #9:** abierto, borrador, `merged=false`, sin conflicto en la consulta del 17-oct; **NO fusionado**. `main` sigue intacta.  
**Implementación:** compatibilidad de backups SQLite v3 con futuras versiones, **sin** introducir aún v4 ni tablas para cuentas/personajes/campañas.  
**CI completo:** [Actions #39021921291](https://github.com/Farimuz/D-D/actions/runs/39021921291): `npm ci`, `npm run build`, `npm test` sobre checkout íntegro, Ubuntu 24.04 y Node 22.18.0 **exitosos**: **160/160 unitarias, 50/50 integraciones aplicables (+2 Windows omitidas), 266/266 E2E, 13/13 multijugador = 489 aprobadas, 2 omitidas**. Los tres jobs del workflow quedaron verdes.  
**Falta para cerrar PR 1-A:** **auditoría destructiva por revisor diferente del implementador**; analizar informe, corregir hallazgos genuinos, revalidar el commit final y pedir autorización explícita para merge. El mismo asistente efectuó una segunda revisión técnica y publicó un review `COMMENTED`, pero **NO fue auditoría independiente**.  
**Siguiente acción recomendada:** pedir a Codex (sesión distinta, contexto de revisión, sin escribir inicialmente) auditoría adversarial integral del PR #9, informando hallazgos con reproducción y criticidad. **No empezar PR 1-B ni fusionar PR #9 por cuenta propia.**

### Enlaces de referencia rápida

- [Estado funcional y acuerdos](PROJECT_STATUS.md) — canónico, pero la cabecera histórica puede mencionar commits anteriores; corroborar HEAD.
- [Plan aprobado, entregas PR 0–9](IMPLEMENTATION_PLAN.md).
- [Decisión 0004: cuentas y selección libre](decisions/0004-cuentas-invitaciones-personajes.md).
- [UX provisional jugador/DM](design/PLAYER_DM_UX.md).
- [Arquitectura portable](architecture/portable-runtime.md).
- [Persistencia fase B](architecture/phase-b-persistence.md).
- [Auditoría final histórica v0.0.5](architecture/v0.0.5-final-audit.md).
- [Especificación y evidencia inicial de PR 1-A](https://github.com/Farimuz/D-D/blob/feat/pr1a-backup-schema-compat/docs/architecture/pr1a-backup-schema-compatibility.md) — escrita ANTES de disponer del CI final, por lo que algunos enunciados sobre «suite incompleta» quedaron desactualizados; priorizar el cuerpo actualizado del PR #9 y Actions.
- [Revisión técnica anterior en PR #9](https://github.com/Farimuz/D-D/pull/9) — comentario tipo review `COMMENTED` del **mismo implementador**.

## 1. Qué se construye: producto y acuerdos consolidados

Una mesa virtual propia (VTT) de D&D 5e para amigos principiantes, español, PC y móvil. El usuario será inicialmente DM/administrador, no se pretende una red social ni una clonación de Nivel20/D&D Beyond. Priorizar funcionamiento estable, uso cómodo y núcleo portable/autoritativo; integrar **mapas externos** antes que generar mapas (decisión 0001). No automatizar todas las reglas inicialmente.

La base v0.0.5 ya implementa tablero compartido, fichas/tokens, niebla, medición, permisos DM/jugador, WebSocket Node, persistencia SQLite + mapas filesystem, reinicio/backup/restore. Es núcleo utilizable, **no** producto completo: no hay todavía cuentas, biblioteca de personajes, campañas independientes, dados universales ni encuentros completos. Los números de versión de UI/package pueden decir 0.0.4; no inferir release nuevo.

### Decisiones de producto ya aprobadas; pendientes de código

- **Registro de cuenta solo por invitación administrativa de un uso**, revocable/caducable; usuario/contraseña, correo opcional; recuperación por código temporal administrativo. Administrador y DM conceptualmente distintos, inicialmente misma persona. Sesiones persistentes y permisos backend.
- **Cuenta y biblioteca de PJ independientes de campaña**. Lobby «Mis personajes» / «Mis campañas».
- **Hoja manual flexible con autoguardado** y borradores incompletos; «Listo»/«En preparación» marcado manualmente por jugador, reversible e informativo, no bloqueo.
- **Invitación a campaña distinta de invitación de registro. El jugador elige libremente el PJ activo en campaña sin aprobación formal del DM**. Un PJ activo por jugador/campaña, el DM observa elección. Cambiarlo después y usar el mismo PJ simultáneamente en varias campañas permanecen abiertos.
- Separar **cuenta → personaje → participación en campaña → ficha/token → campaña → sesión/encuentro**. Una ficha del tablero no equivale a PJ; un solo origen de verdad para HP, no borrar PJ al borrar token.
- Hoja híbrida de personaje con resumen y secciones inventario, habilidades, hechizos, notas; UI jugador/DM en PC y móvil provisionalmente validada como dirección, no implementada.
- Dados universales d4/d6/d8/d10/d12/d20/d100, fórmula editable y controles, resultado **generado y persistido por servidor** con idempotencia durable (no confundir `requestId` de correlación con garantía de ejecución única); tiradas no aplican daño automáticamente.
- Daño/curación manual por cantidad, HP temporal separado, acciones rápidas, aviso discreto al DM con sesión activa.
- Encuentros manuales, iniciativa, rondas/turnos, notas privadas/compartidas, conservación tras reconexión/reinicio.
- 2014 frente a 2024, privacidad exacta de tiradas, política de cambio PJ y otros detalles avanzados no decididos. Evitar implementar automatismos no autorizados.

### Ruta técnica aprobada

PR 0 documentación (**completo**, fue PR GitHub #8 integrado) → **PR 1-A** compatibilidad backup (PR #9 en borrador) → **PR 1-B** nuevas entidades y migración real v3→v4 (**no iniciado**) → PR 2 cuentas → PR 3 personajes → PR 4 campañas/lobby → PR 5 integrar personajes y tablero → PR 6 dados → PR 7 HP/recursos/sesiones → PR 8 combate/notas → PR 9 UX integrada/regresión.

Se decidió dividir PR 1 por riesgo: primero seguridad de backups históricos, luego entidades. La aprobación de plan no autoriza todos los PRs ni merges posteriores.

## 2. Detalles de PR 1-A verificados sobre GitHub

### Archivos cambiados en PR #9, HEAD `1b1a039…`

1. `src/infrastructure/node/sqlite/schema.ts`: `MIN_RESTORABLE_BACKUP_SCHEMA_VERSION = 3`; `SCHEMA_VERSION` **permanece en 3**. Leer esquemas admitidos en `readOnly` sin migrar; inicio escribible conserva migraciones transaccionales. Pre-v3 solo se admite como entrada al migrador writable, no como backup histórico directamente restaurable.
2. `src/infrastructure/node/backup.ts`: manifiesto `dnd-backup` formato conocido; `schemaVersion` entero seguro dentro de [3, versión actual]; compara checksum SHA-256, versión real `PRAGMA user_version` y versión declarada, con rechazo antes de crear destino; conserva verificaciones de `runtime_lease`, `storage_identity`, assets y flags de restauración.
3. `tests/unit/backup.test.ts`: casos de versión inferior, futura y fraccional; discrepancia de versión real/manifest incluso con checksum recalculado.
4. `tests/unit/sqliteRoomStore.test.ts`: lectura de esquema read-only sin migración y rechazo de versiones inferiores.
5. `docs/architecture/pr1a-backup-schema-compatibility.md`: decisión y evidencia preliminar (ver advertencia sobre contenido obsoleto).
6. `.github/workflows/pr1a-validation.yml`: checkout completo, Node 22.18.0, `npm ci`, instalación navegadores, `npm run build` y `npm test`; jobs de comparación Edge contra `main` y commit del PR.

**Fuera de alcance y no modificados por PR 1-A:** `RoomState`, interfaz, sistema de cuentas, API de juego, permisos existentes, tablas de campaña/PJ, Oracle, Hermes, despliegue, esquema v4 real. Base histórica de PR 1-A: `a70014a152a0e763aed6ebdc99a226362b2891ca`.

### Historial de validación verificable

- Corrida [#39020860211](https://github.com/Farimuz/D-D/actions/runs/39020860211): checkout/`npm ci`/build y 160 tests unitarios correctos; fallo integración del lanzador de desarrollo al buscar `Local:` en salida Vite con colores ANSI. Se modificó **solo** entorno CI con `NO_COLOR` / `FORCE_COLOR`.
- Corrida [#39021064684](https://github.com/Farimuz/D-D/actions/runs/39021064684): unitarias 160/160, integración 50/50 aplicables (2 Windows omitidas), E2E **265/266**, una falla Edge [map.spec.ts](https://github.com/Farimuz/D-D/blob/main/tests/e2e/map.spec.ts) sobre escala de mapa (esperado `1.25`, observado `16`). [Artefacto/trace](https://github.com/Farimuz/D-D/actions/runs/39021064684/artifacts/12096469471) conservado. Ese editor no fue tocado en PR 1-A; no se demostró causa raíz ni que el defecto sea preexistente.
- Corrida **exitosa** [#39021921291](https://github.com/Farimuz/D-D/actions/runs/39021921291), HEAD `1b1a039…`: `npm ci`, build y test verde (160 unit, 50 integración, 266 E2E, 13 multiplayer; 2 omitidas Windows).
- En la misma corrida verde, prueba focalizada de Edge «map adjustment never moves tokens» se ejecutó **2/2 veces sobre `main` y 2/2 sobre PR 1-A**, sin reproducir fallo. Interpretación prudente: incidencia intermitente, no se puede atribuir con evidencia actual al PR.

**Precisiones:** Las 489 aprobadas son de la ejecución final en runner Ubuntu x64 con Node 22.18.0, NO 489 aprobadas en Windows ni Oracle. Las dos omisiones son tests Windows. Los ensayos reconstruidos de Node 22.16 de una etapa previa no reemplazan ni contradicen este CI completo. Las pruebas completas CI NO sustituyen revisión independiente.

### Auditoría de segunda pasada realizada por implementador

Hubo inspección adversarial del diff sobre límites de versiones, manifiestos falsos, datos corruptos, restauraciones interrumpidas, atomicidad, conservación de mapa/sala/accesos, schema futuro y ausencia de cambios de permisos. Se registró en PR #9 como review con estado `COMMENTED`, **no `APPROVED`**, y el cuerpo advierte explícitamente que fue el mismo asistente que desarrolló el código. **No existe auditoría independiente cerrada** al momento del corte.

## 3. Único siguiente trabajo recomendado: auditoría independiente destructiva del PR #9

Encargar a **Codex en sesión/agente independiente del implementador**, con checkout íntegro de `Farimuz/D-D` y PR #9, una investigación escéptica, **solo lectura y ejecución de tests primero**. No hacer correcciones o merge sin revisar hallazgos.

### Lista de ataques mínima

1. Comparar PR #9 contra su base exacta e inspeccionar `backup.ts`, `schema.ts`, tests y workflow. Identificar código viejo que se comporta distinto en read-only o ante fallos.
2. Examinar manifiestos con versiones e índices extraños: NaN/no enteros, futuro, inferior a 3, correspondencia manifiesto/SQLite, hash recalculado, estructura SQLite ilegítima, `runtime_lease` ocupada.
3. Probar que un backup fuente es inmutable y destino previo no se sobrescribe; que fallos entre crear directorio, copiar SQLite, cambiar binding y publicar preservan indicadores protectores y permiten recuperar.
4. Comprobar que el contrato de lectura antigua no evade validaciones de tablas/keys, que errores se clasifican con precisión y que migraciones de writable siguen siendo atómicas.
5. Buscar incompatibilidades no cubiertas para futura v4, incluida validación de **entidades nuevas**, y diferenciar entre defecto actual bloqueante y obligación futura de PR 1-B.
6. Examinar posibilidad de cambios no autorizados en mapa, token, permisos o `RoomState`, o de pérdida/duplicación de datos en concurrencia y recuperación.
7. Criticar pruebas por **falsos positivos**, escenarios ausentes, fugas de recursos, dependencias de plataforma y cobertura insuficiente. Verificar CI logs reales, su commit y los 2 skips de Windows; decidir si es necesario un runner Windows antes del merge.
8. Evaluar si el caso Edge intermitente es independiente y si debe convertirse en issue separado; no declararlo resuelto sin reproducción/diagnóstico.

### Formato exigido del informe

- **Resumen ejecutivo:** `APPROVED` / `CHANGES_REQUIRED` / `BLOCKED_BY_ENVIRONMENT`, con justificación.
- **Hallazgos ordenados por severidad**: bloqueante, alta, media, baja; archivo/línea, condición de activación, evidencia reproducible, impacto sobre partidas/datos, recomendación mínima.
- **Cobertura:** pruebas ejecutadas/reproducidas, comandos exactos, runtime y resultado; diferenciar lo verificado de lo inferido.
- **Decisiones arquitectónicas**: costos, riesgo, alternativa con menos complejidad; preservar portabilidad del core.
- **Pendientes futuros** de PR 1-B separados de defectos actuales.
- **Límites**: lo que no se pudo ejecutar/comprobar. No falsificar independencia ni resultados.

### Para cerrar auditoría e integrar (NO autorizado todavía)

1. Recibir informe independiente; validar cada hallazgo sin descartar críticas automáticamente.
2. Corregir errores bloqueantes/altos (y los medios necesarios) en rama PR #9, **solo con autorización de cambios**; no iniciar PR 1-B para resolverlos.
3. Ejecutar pruebas relevantes, y si cambian rutas críticas, volver a correr `npm ci`, `npm run build`, `npm test` sobre **nuevo commit exacto** en entorno soportado. Contrastar resultados GitHub Actions.
4. Obtener dictamen independiente final sobre commit corregido, sin bloqueantes, registrar evidencia. Si se decide que Windows es condición de cierre, ejecutar también las pruebas allí.
5. Marcar PR listo para revisión y **pedir autorización de merge** al usuario antes de fusionarlo con `main`. Confirmar `main`/PR antes y después.
6. **Después**, solo con nueva autorización, comenzar PR 1-B: esquema 4 real, cuentas/PJ/campañas como entidades persistentes y test real backup v3→v4.

## 4. Instrucciones de colaboración y límites de autorización

- Actuar como ingeniero senior que **cuestiona constructivamente tanto las propuestas del usuario como las propias**, distingue verificado/hipotético, explica riesgos y evita complejidad innecesaria. Usuario valora progresos pequeños y auditorías adversariales.
- **No crear cambios funcionales, merges, releases, despliegues ni tocar proyectos ajenos (Hermes, Oracle, La Zona)** sin autorización expresa. En la conversación anterior sí se autorizó PR 1-A (rama, implementación, tests y auditoría), pero **no su integración**. La solicitud actual autorizó solo documentar la continuidad.
- No confundir **hoja de personaje persistente** con `Token` del tablero; preservar capacidad multiplataforma y núcleo Node-autoritativo. No reescribir el sistema existente sin justificación.
- Todos los vínculos a ramas y SHAs pueden cambiar; antes de trabajar consultar GitHub actualizado. El hecho de que un documento diga «PR actual = PR 0» refleja su antigüedad, no el último estado verificado.
- Si no hay acceso al repositorio completo en el nuevo entorno, declararlo antes de atribuirse pruebas. Preferir CI reproducible con logs.

## 5. Inicio recomendado de conversación nueva (mensaje para copiar)

> Retomemos el proyecto D&D desde su punto de continuidad en GitHub. Repositorio `Farimuz/D-D`. Lee primero `docs/CONTEXT_HANDOFF_2026-10-17.md` de la rama `docs/handoff-pr1a-2026-10-17`, luego `docs/PROJECT_STATUS.md` y `docs/IMPLEMENTATION_PLAN.md` de `main`, y revisa el PR #9 (`https://github.com/Farimuz/D-D/pull/9`), sus commits, diff, reviews y acciones. El PR 1-A está implementado con CI completa verde (489 aprobadas, 2 omitidas Windows), pero **NO integrado** porque falta la auditoría destructiva verdaderamente independiente. Quiero que primero reconstruyas y verifiques el estado, distingas hallazgos/riesgos y prepares un prompt exigente para que Codex audite independientemente PR #9, en modo solo lectura inicial. No implementes PR 1-B, no cambies código ni hagas merge/despliegue sin mi autorización. Si hay diferencias con el documento, explícame cuáles son.

---

**Fin de entrega de contexto. Este archivo es un handoff de lectura, no aprobación técnica ni autorización para fusionar el PR #9.**
