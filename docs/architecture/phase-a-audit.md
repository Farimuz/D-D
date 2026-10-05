# Auditoría destructiva independiente — v0.0.5-A

Fecha: 2026-10-05. Alcance exclusivo: fase A; sin SQLite, assets persistentes, despliegues, cambios de UX ni nuevas funciones de juego. La decisión [0003](../decisions/0003-portable-core-infrastructure-adapters.md) sigue siendo vinculante.

## Estado y procedencia

La auditoría empezó en `feat/v0.0.5-portable-persistence`, workspace limpio, HEAD `b8393954c2f2978c6a4852025a9bf22b099174b4`. Tras fetch, `origin/main` y merge-base coincidían en `78e4b4fdc9d4ce7b0c73e121c53d06ee6f78612c`. Se revisaron los cuatro commits `1219537`, `be8aa35`, `42e02ae` y `b839395`, y todos los archivos del diff de 21 archivos contra main. La rama no existía en remoto y se publicó. No se reescribieron commits, no se abrió PR y no se fusionó main.

El reporte previo de 348 pruebas se conserva como antecedente, no como evidencia de esta auditoría. Las pruebas nuevas y la ejecución limpia descritas abajo verifican el código revisado independientemente.

## Hallazgos y correcciones

No se identificó un hallazgo crítico. Los siguientes defectos son demostrables sobre el adaptador inyectable; los fallos de IO simulados no afirman que MemoryRoomStore falle espontáneamente.

| Severidad | Problema y causa | Corrección | Evidencia de regresión | Commit |
| --- | --- | --- | --- | --- |
| ALTO | Cerrar servidor llamaba a `Rooms.clear()`, que borraba todos los registros del store; peligro de borrar futuras salas durables | `releaseRuntime()` libera accesos, presencia y bytes sin borrar dominio; `delete()` es explícito y sweep lo usa; referencias de runtime liberadas no autorizan acciones | `integration/lifecycle.test.ts` cierra un servidor real y verifica registro retenido; `unit/roomStore.test.ts` distingue expiración, liberación y eliminación | `a1f4b14` |
| ALTO | Acción WS o subida HTTP guardadas podían responder rechazo/500 si fallaba una lectura posterior durante broadcast o construcción de respuesta | Publicar el estado recién confirmado y responder con sus campos explícitos, sin relectura; no retener otra copia autoritativa en sesiones | Dos tests `audit: read failure after committed…` en `integration/rooms.test.ts`; verifican revisión, mensaje, campos del wire y bytes | `df8a83d` |
| MEDIO | Spreads en proyecciones propagaban campos extra privados si un store entregaba objetos ampliados | Construcción explícita de campos de board, token, mapa, niebla y participante; conserva omisión de opcionales compatible con v0.0.4 | `unit/phaseAAudit.test.ts` inyecta sentinelas privados en todos los niveles; no salen a DM ni jugador | `1c34840` |
| MEDIO | Callbacks de cierre WS y heartbeat no contenían errores del store; podían terminar el proceso. DM aumentaba presencia antes de cargar estado | Lectura DM antes de conceder presencia; fallos de lectura/barrido se contienen mediante el envelope genérico de error existente; eliminación fallida conserva registro y runtime | Tests reales de join, desconexión fallida recuperable y expiración fallida con health 200 | `df8a83d` |
| MEDIO | TypeScript aceptaba métodos async/Promise para save/delete con retorno void, aunque Node no los espera | Retorno síncrono `undefined` en contrato y adaptadores, sin cambio de comportamiento | Probe de compilación en `unit/architectureAudit.test.ts`: rechaza métodos Promise de load/save/delete y admite métodos síncronos | `b11d352` |

Antes de las correcciones, la primera ejecución de nueve casos de auditoría produjo cinco aprobados y cuatro fallidos: cierre destructivo, campos extra en proyección, falso rechazo WS y falso 500 HTTP. Tras cada corrección se ejecutaron sus pruebas relevantes. No se afirma una explotación por un cliente remoto: los campos desconocidos de entrada ya se rechazan; el hallazgo de proyección protege la frontera con stores actuales/futuros.

El probe posterior de tipado falló también sobre el contrato original: los dos `@ts-expect-error` de save/delete resultaban innecesarios porque el compilador aceptaba esas funciones async. Tras corregirlo pasa con las tres restricciones. Es protección de compilación; un consumidor JavaScript sin tipos o que fuerce un cast aún debe respetar el contrato, igual que debe respetar su semántica atómica.

## Core y dependencias transitivas

El core conserva estado autoritativo neutral, acciones, validación semántica, límites de participantes/fichas/niebla, asignación, permisos actuales, mutaciones, revisión y proyecciones DM/jugador. Depende únicamente de sus cuatro módulos y de `state/model.ts`, `state/validation.ts`, `map/limits.ts`, `map/fog.ts` y `map/geometry.ts`: nueve módulos neutrales en total. No importa HTTP, Node, ws, React, DOM, almacenamiento de navegador, SQL, filesystem ni conexiones.

La prueba nueva `unit/architectureAudit.test.ts` compila toda esa clausura con librería ES2022 y `types: []`, verifica los archivos transitivos reales del compilador y rechaza dependencias externas al código neutral, reloj y carga dinámica. Un probe temporal adicional comprueba que el contrato síncrono rechace los tres métodos Promise. Complementa la ejecución del escenario DM+A+B en VM/bundle con Node, navegador, sockets, red, reloj, crypto y timers ausentes. El compilador/harness sí se ejecuta en Node; el dominio no utiliza sus APIs.

Node mantiene autenticación y hashes, generación criptográfica, sockets y sesiones, HTTP, uploads, bytes, presencia, reloj, límites del proceso y lifecycle. Las validaciones del protocolo reexportan las del core; las rutas HTTP validan bytes y autentican antes de delegar metadata al mismo core. No hay una segunda implementación de permisos o de visibilidad en Node. La UI reutiliza la función neutral de visibilidad para presentación local; la autoridad online sigue exclusivamente en core.

## RoomStore, atomicidad y revisión

`load(id)`, `save(state)` y `delete(id)` reciben/devuelven datos JSON, sin Map ni handles privados en su contrato. MemoryRoomStore serializa/deserializa tanto escritura como lectura. Otro store de prueba guarda strings y devuelve objetos recién deserializados: acciones y proyecciones funcionan sin identidad compartida ni un board paralelo en RAM.

El contrato de A es síncrono y explícito, no una promesa de IO asíncrono. Una implementación SQLite síncrona es razonable: [Node documenta DatabaseSync](https://nodejs.org/api/sqlite.html#class-databasesync). Para Cloudflare futuro, su almacenamiento SQLite ofrece SQL y [KV síncronos y transactionSync](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/); el adaptador debe respetar transacciones y confirmación de salida del proveedor. Las APIs KV asíncronas requerirían ajustar puerto/coordinación y esperas de infraestructura. Nada de esto exige cambiar reglas, acciones ni proyecciones puras; no se implementó ni probó Cloudflare.

Las siete acciones se prueban con errores de load y save anteriores al commit: board, participantes, revisión, actividad y bytes anteriores permanecen intactos. Rechazos de validación/permisos también conservan estado. Save exitoso antecede cambios de runtime y publicación; snapshots confirmados no se vuelven a cargar. Un fallo de presencia no emite un snapshot parcial o inventado. Un socket fallido no convierte un commit en rechazo ni detiene la publicación a los demás.

**Límite comprobado:** un store deliberadamente incorrecto que escribe y después lanza una excepción deja el estado guardado. El test es un contraejemplo al rollback, no una garantía de atomicidad. MemoryRoomStore copia antes de modificar su Map y cumple el contrato. Un adaptador durable debe asegurar resultado conocido mediante su transacción o tratar commit incierto como tal; no se puede deshacer arbitrariamente desde core sin riesgo de borrar una escritura posterior.

La revisión aumenta exactamente una vez por acción aceptada y reemplazo de metadata de mapa. Incluye comandos válidos sin cambio material: mover a la misma casilla, niebla ya vacía, borrar un mapa ausente o reset de mesa vacía. Es compatible con v0.0.4. No aumenta por rechazo, fallo anterior a commit, join/rename de participante, desconexión o presencia. No es una versión de todas las escrituras de RoomState.

## Autoridad, privacidad y protocolo

Se verifican movimiento propio, ajeno y sin asignación; fichas Solo DM o cubiertas; creación, nombre, visibilidad, borrado, niebla, mapa y reset; campos de autoridad manipulados y reutilización después de revocación. El DM conserva las siete acciones y la importación HTTP. El actor viene de la sesión autenticada, no del payload.

La matriz nueva combina tres asignaciones (propia/ajena/nula) con público/Solo DM y cubierto/descubierto: doce combinaciones. Solo el token propio público y descubierto admite movimiento del jugador. La asignación no omite el filtro de niebla. Proyecciones profundas excluyen fichas secretas, nombres ajenos, credenciales, hashes, identidades privadas y campos desconocidos. Los IDs públicos de participantes que aparecen como ownerId no son credenciales.

Join, acciones, state, result y error mantienen los contratos de v0.0.4. El resultado interno con `state` nunca se expande en el ack; los tests verifican las claves exactas. `STORAGE` utiliza el envelope de error ya existente y un mensaje genérico sin detalles ni secretos. No se introdujeron bindings de proveedores ni una acción nueva.

## Concurrencia, lifecycle, accesos y assets

**OBSERVACIÓN — lost updates fuera del coordinador actual.** Dos lecturas de una misma revisión, seguidas de escrituras completas, pueden perder el primer cambio: se reprodujo. RoomStore no ofrece CAS. Node actual ejecuta load → core → save → actualización de runtime → publicación sin await; así ordena acciones WS, joins y commit de mapa. El await de recepción de bytes queda antes de ese tramo y hay exclusión de upload por sala. Los parches ordenados preservan renombres y movimientos, y comprueban asignación actual. Esta garantía no cubre varios procesos, otro escritor ni IO asíncrono.

Para B, proteger **toda** la operación read/modify/write, incluidos participantes/accesos, con transacción y coordinación por sala. Un CAS basado solo en revisión del board no detectaría dos joins; si se elige CAS, necesita versión de almacenamiento separada. Puede cambiar la infraestructura sin rediseñar dominio.

Crear guarda dominio antes de publicar runtime/acceso. Reconectar resuelve hash de identidad al mismo participant ID; desconectar solo ajusta presencia. Expirar elimina explícitamente una sala completamente inactiva tras treinta minutos. Cerrar descarga runtime y no borra registros del store. El store por defecto sigue siendo temporal y no hay rehidratación tras reinicio. B debe decidir expresamente si la expiración durable elimina, archiva o solo descarga; shutdown siempre debe conservar datos.

Credential DM solo se entrega al crear y se guarda en el navegador del DM por sala; Node conserva SHA-256. Identity jugador queda en su navegador; Node conserva hash y participant ID. Room ID y entity IDs son públicos y neutrales. Crypto no entra en core. B debe persistir un envelope privado versionado con hashes/asociaciones de acceso y actividad, separado del RoomState y de los snapshots. Sockets, conexiones, presence, bufferedAmount y locks de transferencia siguen efímeros y se reconstruyen.

Core solo ve `MapAsset {id,x,y,width,height,scale}`. `ImageAsset {id,bytes,type}`, buffers, URLs de entrega y headers están en Node. B debe convertir guardar/leer/reemplazar/borrar esos bytes y sus metadatos técnicos en AssetStore filesystem, manteniendo el ID portable. Hoy metadata y bytes son coherentes dentro del tramo síncrono; no existe garantía ante crash ni retención durable.

## Medición y complejidad

Se reforzó el caso existente de medición, sin multiplicar E2E: activa Medir, muestra 10 ft, termina con Listo, reactiva sin restos y vuelve a desactivar. Verifica igualdad completa del board autoritativo y su revisión, cero mensajes WebSocket salientes durante la medición, ausencia de medición en DM/otro jugador y ausencia de controles DM. Pasó independientemente en escritorio Chrome, Android emulado con contactos CDP e iPhone/WebKit emulado con Pointer Events sintéticos; no acredita hardware físico. Commit `f4997bb`.

No se encontró una abstracción ceremonial que justificara eliminación. RoomStore tiene una sustitución probada; MemoryRoomStore proporciona aislamiento; Rooms coordina acceso/runtime; createRoomServer ya sirve tests y ejecución real. No se añadieron DI container, event bus, ORM, repositorio genérico, middleware, cola distribuida ni framework de assets.

## Verificación limpia

Se eliminaron únicamente dist, test-results y playwright-report dentro del workspace, tras verificar sus rutas y que no fueran enlaces. `npm ci` reinstaló 32 paquetes según el lockfile existente, sin cambiar dependencias. Entorno: Node 24.21.0, npm 11.19.0. Build TypeScript/Vite y `npm test` se volvieron a lanzar desde cero.

La ejecución final, posterior a todas las correcciones sobre código `b11d352700c17aee93075dea303c15694cdec8fe`, terminó con código 0. Se repitieron limpieza, instalación, build y suite completa después de la última corrección de tipado. Los cambios posteriores son exclusivamente este informe y referencias documentales.

| Suite | Ejecutados y aprobados |
| --- | ---: |
| Unitarios, incluida arquitectura y probe de contrato | 67 |
| Integración HTTP/WebSocket y lifecycle | 14 |
| Compatibilidad local en seis perfiles | 266 |
| Multijugador en tres perfiles | 13 |
| **Total** | **360** |

Unidades/integración: cero fallos, cancelados u omitidos. Playwright: 266 aprobados (13.2 min) y 13 aprobados (1.1 min), sin reintentos, y ambos archivos `.last-run.json` con `status: passed` y `failedTests: []`. Se conservaron los filtros de perfiles existentes; no se duplicó alineación de DM en perfiles móviles. Los tres casos reforzados de Medir pasaron en esta ejecución final. TypeScript y Vite terminaron con código 0; también se confirmó build tras las pruebas. Solo apareció el aviso ambiental NO_COLOR/FORCE_COLOR y pasaron los controles de consola de los tests.

La revisión final comprobó diff sin errores de whitespace, ausencia de cambios en App/Board, dependencias y lockfile, y ausencia de claves privadas/tokens reconocibles en archivos versionados. node_modules, dist y test-results siguen ignorados; los logs de ejecución quedaron fuera del repositorio. No hay garantía de una búsqueda de secretos exhaustiva más allá de esos patrones y la revisión del diff.

## Evaluación y recomendación para fase B

**FASE_A_APPROVED.** Con las correcciones y la suite limpia, la frontera del dominio permite empezar SQLite/filesystem sin rediseñar reglas, acciones o proyecciones. La aprobación corresponde únicamente a fase A; no acredita persistencia implementada, comportamiento ante crash durable, hardware móvil físico ni aptitud de producción. Los límites de concurrencia y commit incierto quedan explícitamente como obligaciones de los adaptadores de B.

Orden recomendado, pendiente de autorización de B:

1. SQLiteRoomStore y envelope privado separados, JSON/schema versionados y validados al cargar; mantener las pruebas de store deserializado y fallos. Verificar el driver contra la versión Node soportada antes de elegirlo.
2. Transacción que abarque lectura, acciones/joins, guardado y metadata privada; serializar por sala y definir conflicto/reintento. SQLite admite [transacciones explícitas](https://www.sqlite.org/lang_transaction.html); confirmar a clientes solo tras commit conocido. Probar dos escritores y error de disco/commit incierto.
3. AssetStore filesystem: preparar archivo temporal en el mismo volumen, validar y sincronizar bytes/metadatos según la plataforma antes de confirmar su referencia. Publicar bajo ID estable y actualizar referencia en SQLite; conservar el antiguo hasta commit y limpiar después. No introducir rutas físicas en dominio ni asumir que un rename solo demuestra durabilidad ante pérdida de energía.
4. Reinicio real: cargar salas/accesos/actividad, verificar referencias de assets, reconstruir runtime desconectado y conservar asignaciones. Shutdown no elimina; política de expiración durable explícita.
5. Migraciones transaccionales y rechazo de esquema futuro/corrupto sin sobrescribir; backups consistentes con assets referenciados y restauración probada. Preferir una [copia consistente de SQLite](https://www.sqlite.org/backup.html) y un manifest de assets; no copiar a ciegas una base abierta.
6. Recuperación de escrituras interrumpidas: fallos antes/después de publicar archivo, commit, cambio de referencia y cleanup; barrido de temporales/huérfanos que no borre assets referenciados. Probar crash real, disco lleno y permisos denegados antes de declarar persistencia verificada.

No se implementó ninguno de estos pasos de B.
