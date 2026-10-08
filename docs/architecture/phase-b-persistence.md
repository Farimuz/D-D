# D&D v0.0.5-B — Persistencia Node

Estado: **FASE_B_IMPLEMENTED**, pendiente de auditoría independiente. Implementación sobre `feat/v0.0.5-portable-persistence`, conservando la Fase A aprobada en `c172c7f`. No constituye aprobación de auditoría ni despliegue. El paquete mantiene 0.0.4; no se creó tag de release.

## Arquitectura y driver

La [decisión 0003](../decisions/0003-portable-core-infrastructure-adapters.md) permanece vinculante. Core conserva permisos, acciones, proyecciones, geometría, niebla, Solo DM y revisión. `RoomState` contiene `id`, `board`, `revision` y participantes públicos. Nunca contiene rutas, sockets, credenciales, hashes ni bytes. El protocolo conserva envelopes; el cliente mantiene cámara, zoom y medición local. Las reglas y la UI no cambian en B.

`src/infrastructure/node/sqlite/roomStore.ts` implementa el contrato síncrono `load/save/delete`; `persistence.ts` añade únicamente coordinación de estado/acceso/assets para Node. `server/rooms.ts` carga estado actual y autentica antes de transformarlo. Sus getters consultan el almacén; no mantienen otro board autoritativo. `MemoryRoomStore` permanece para tests puros y modo temporal. El grafo del core se compila y ejecuta sin Node, red, navegador, crypto, reloj ni timers.

Se usa `node:sqlite`, `DatabaseSync` y `backup`, sin ORM ni nuevas dependencias. Node mínimo sigue en **22.18.0**. `isTransaction` y `backup` existen desde 22.16; la API de SQLite en 22.18 tiene estabilidad 1.1, desarrollo activo, y emite `ExperimentalWarning`. [API oficial de Node 22.18](https://nodejs.org/download/release/v22.18.0/docs/api/sqlite.html).

Se ejecutaron pruebas en Windows x64 con Node **22.18.0 / SQLite 3.50.2** y **24.21.0 / SQLite 3.53.4**. Existen binarios oficiales de [Node 22.18 para Windows y Linux ARM64](https://nodejs.org/en/blog/release/v22.18.0). No se ejecutó esta implementación en hardware/VM Linux ARM64: soporte del runtime verificado documentalmente, validación del producto en ese host pendiente. IO y consultas síncronas pueden bloquear el event loop; esta versión admite un servidor por base, sin escalado horizontal.

## Esquema y tres versiones distintas

SQLite usa tablas `STRICT`, claves foráneas activas, WAL, `synchronous=FULL` y espera máxima de bloqueo de 250 ms. Se comprueban `quick_check`, claves foráneas, JSON neutral, accesos y metadatos. Objetos cargados están separados; una carga no expone referencias internas mutables.

| Dato | Ubicación / propósito |
| --- | --- |
| Estado neutral | `rooms(id, state_json, storage_version)`; único board autoritativo |
| Acceso privado | `room_access(room_id, dm_hash, identities_json, last_active)`; FK con borrado en cascada |
| Catálogo técnico | `assets(id, content_type, byte_length, sha256, width, height)` |
| Confirmación | `commit_receipts(operation_id, committed_at)`; evidencia de commit, sin comandos/eventos |
| Runtime exclusivo | `runtime_lease(id=1, pid, nonce)`; lease operativo, sin sesiones/presencia |
| Binding de directorio | `storage_identity(id=1, value)`; UUID que identifica la pareja DB/assets |

`PRAGMA user_version=3` es la versión del esquema. `storage_version` cambia al guardar estado/acceso y permite detectar escrituras obsoletas. `RoomState.revision` es la revisión del tablero: acciones aceptadas la incrementan; registrar/renombrar participantes no lo hace. No se usa como CAS de toda la sala.

Esquema 0 vacío crea tablas; una base no vacía sin versión reconocida se rechaza. Se soportan v1 (solo `rooms`, sin accesos originales que puedan inventarse) y v2 (estado/acceso/catálogo, anterior al binding). Se validan datos y se aplican DDL/versionado en una transacción de escritura; una interrupción de migración revierte DDL y versión. V3 se valida en una instantánea de lectura. Versiones futuras, corrupción o forma desconocida se rechazan, conservando los datos para inspección. Una sala neutral v1 sin hashes no se convierte automáticamente en sala online recuperable. Estas versiones antiguas son esquemas explícitos de infraestructura, no migraciones de mesas del navegador.

No hay migraciones destructivas en B. Cualquier migración destructiva futura requiere backup previo y una estrategia nueva explícita. No se repara corrupción sobrescribiendo silenciosamente estado o hashes.

## Transacciones, acceso y resultados

Cada comando durable sigue `BEGIN IMMEDIATE → leer → autenticar/validar → transformar core → guardar estado/acceso/metadatos → confirmar → proyectar`. El bloqueo excluye escritores independientes durante todo el tramo. Fuera de la coordinación, `save` exige la versión de un objeto cargado; una lectura obsoleta o un objeto transformado sin transacción genera `CONFLICT`. La coordinación síncrona evita intercalaciones dentro del proceso. Trabajo Promise dentro de una transacción se rechaza y revierte. [Semántica transaccional de SQLite](https://www.sqlite.org/lang_transaction.html).

Solo se devuelve éxito después de confirmar. Cada transacción con cambios registra un UUID de operación antes de COMMIT. Ante un error se consulta `isTransaction`, se intenta rollback si sigue abierta y se reconcilia el recibo:

| Resultado comprobado | Comportamiento |
| --- | --- |
| Fallo sin escritura / bloqueo | No se ejecuta/repite el comando; estado sin cambios |
| Rollback confirmado, sin recibo | Rechazo; estado/acceso/revisión previos |
| Recibo presente | Commit confirmado: devuelve el resultado capturado aunque hubiera excepción posterior |
| No puede confirmarse rollback/recibo | `COMMIT_UNCERTAIN`; cuarentena de lecturas, escrituras y cleanup hasta cerrar/reabrir |

Nunca se restaura un board antiguo sobre uno confirmado. HTTP comunica incertidumbre con 503 y código; WebSocket envía error y cierra con 1013, sin `result.ok=false` definitivo. Al reiniciar se valida autoridad durable y se reconstruye presencia; se comprueba la mesa antes de repetir. Si queda incierta una creación inicial, su credencial puede no haber llegado al navegador; los hashes no permiten recuperarla como plaintext. El cliente existente no acumula ni reproduce comandos offline. Los recibos no son un log de eventos ni un mecanismo de reenvío; su crecimiento no tiene compactación automática todavía.

El DM usa SHA-256 de una credencial aleatoria de 256 bits; la comparación conserva tiempo constante. Las identidades de jugador se guardan como hashes ligados uno a uno a IDs públicos. Estado y asociaciones se confirman juntos. La credencial plaintext aparece solo en la respuesta inicial y el navegador que la conserva. Proyecciones usan whitelist del core: ningún hash, credencial, versión de almacenamiento ni asociación privada sale por `state`. El mismo acceso resuelve los mismos IDs tras reiniciar; uno distinto no hereda fichas.

La lease excluye otro servidor Node que intente usar esa base. Un proceso muerto permite reclamarla. Una reutilización de PID por un proceso ajeno vivo puede bloquear conservadoramente el arranque; requiere inspección manual tras asegurar que no existe otro servidor. No se ofrece un comando automático para forzar la lease. Backups eliminan exclusivamente la lease de la copia.

## Assets, filesystem y recuperación

`FilesystemAssetStore` mantiene `assets-owner.json` con formato 1 y la identidad de SQLite. Rechaza un directorio no vacío sin propietario o perteneciente a otra DB. Nombres internos son UUID v4 validados; nombres de subida jamás se usan como rutas. Se mantienen PNG/JPEG/WebP, 25 MiB y 32 millones de píxeles. Metadata técnica comprueba firma, dimensiones, tamaño y SHA-256; el servidor conserva la validación de orientación EXIF. No se añade un decodificador completo.

Los directorios se verifican componente a componente con `lstat`, rechazando symlinks/junctions, y se fijan sus identidades e inode/dev mediante descriptor. Lectura/borrado rechazan enlaces múltiples y archivos ajenos. Linux ancla archivos a `/proc/self/fd/<descriptor>` y exige directorio final del operador sin escritura de grupo/otros; requiere `/proc`. Windows usa comprobaciones de ancestros y descriptores porque Node no ofrece `openat` allí. El directorio debe tener ACL privada del operador: las verificaciones no constituyen una frontera absoluta frente a otro proceso malicioso ejecutado bajo la misma cuenta.

Publicación dentro del bloqueo de escritura:

1. Core y transporte validan nueva geometría/bytes.
2. Crea `UUID.tmp` exclusivo, escribe todos los bytes y sincroniza el archivo.
3. Publica `UUID.asset` por hard link exclusivo, que falla si existe destino; elimina el nombre temporal, sincroniza y relee/verifica bytes.
4. Guarda metadata técnica y referencia neutral junto al acceso privado en SQLite.
5. Confirma el commit y emite el estado capturado.
6. Valida referencias de **todas** las salas y limpia únicamente temporales/huérfanos administrados, luego poda catálogo sin referencia.

SQLite y filesystem **no comparten atomicidad absoluta**. Antes del commit se conserva el mapa anterior; un archivo nuevo incompleto o preparado puede quedar huérfano. Después del commit el nuevo archivo ya está completo y verificable. Un fallo posterior de cleanup conserva el éxito y retiene archivos para mantenimiento posterior. Una incertidumbre no inicia cleanup.

Al arrancar, antes de servir, se comprueban todas las referencias y bytes; una referencia ausente/corrupta detiene el arranque y no inicia borrados. Archivos de nombre desconocido se preservan y se reportan en recovery. Se recupera también la interrupción entre hard link y eliminación del temporal, verificando ambos nombres/inode. Cleanup es idempotente. No hay barrido recursivo de directorios ajenos.

Se sincronizan archivos y, en Linux, directorios. Node no permite sincronizar de forma portable un descriptor de directorio Windows; NTFS/FlushFileBuffers y cachés del hardware tienen límites. Se requiere filesystem local con hard links y semántica SQLite (por ejemplo NTFS/ext4); NFS/unidades de red no están validados. Los crashes de proceso están probados, los cortes físicos de energía/VM/disco no. [FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi-flushfilebuffers), [hard links y junctions](https://learn.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions).

## Lifecycle y configuración

Desconectar cambia presencia y libera sockets; no elimina asignaciones. Cerrar el servidor libera runtime y lease sin `delete` de dominio. En durable, treinta minutos sin conexiones ni subida activa liberan el runtime de la sala, conservando SQLite/assets; entrar otra vez hidrata con conexiones en cero. El máximo de diez salas activas no limita silenciosamente el total guardado. No hay TTL permanente, archivado, administración nueva ni eliminación automática de campañas. Borrado definitivo sigue siendo la operación explícita del adaptador; borrar/resetear mapa conserva semántica de acciones existentes. En temporal se mantiene la expiración anterior.

| Variable | CLI servidor/backup | Valor por defecto |
| --- | --- | --- |
| `DND_STORAGE_MODE` | `--temporary` selecciona memoria | `durable` |
| `DND_DATA_DIR` | `--data-dir` | `.dnd-data` |
| `DND_DB_PATH` | `--database` | `<data-dir>/rooms.sqlite` |
| `DND_ASSETS_DIR` | `--assets-dir` | `<data-dir>/assets` |
| `DND_BACKUP_DIR` | `--backup-dir` | `.dnd-backups` |

Rutas relativas se resuelven desde la raíz donde se ejecuta el comando. SQLite y backups deben quedar fuera del directorio administrado de assets. Variables no entran al core. `npm run dev` inicia backend/Vite con entorno heredado y proxy al puerto `DND_SERVER_PORT` (8787 por defecto); `npm start` usa 8787 y `npm run preview` 4173. `npm start -- --temporary` no requiere datos durables. Reinicia el comando de desarrollo al editar backend.

`.gitignore` excluye `.dnd-data`, `.dnd-backups`, SQLite/WAL/SHM/journal, dependencias, build, reportes y secretos `.env`. Si configuras directorios personalizados, mantenlos fuera del checkout o añade una exclusión local antes de usar Git. Los backups contienen datos de partida y hashes privados; protege sus permisos como los de los datos originales. No hay cifrado ni backups programados.

## Backup y restauración reales

```sh
npm run storage -- backup
# También admite --database, --assets-dir, --backup-dir y --data-dir.
npm run storage -- restore --backup ".dnd-backups/<copia>" --target ".dnd-data/restore-01"
npm start -- --data-dir ".dnd-data/restore-01"
```

La base que se respalda debe existir. El comando imprime un directorio nuevo con fecha/UUID. Un writer mantiene `BEGIN IMMEDIATE`; una segunda conexión de lectura usa la API `node:sqlite.backup` para obtener una instantánea consistente. El bloqueo permanece hasta copiar/verificar los mapas referenciados de todas las salas. Otros comandos de escritura pueden fallar con bloqueo durante esa ventana; no se repiten automáticamente. Conviene elegir una ventana sin ediciones para copias grandes. No se copia ingenuamente el archivo abierto con WAL. [API de backup de SQLite](https://www.sqlite.org/backup.html).

Bundle:

```text
<copia>/
  rooms.sqlite              # snapshot standalone, journal DELETE, lease vacía
  assets/assets-owner.json
  assets/<UUID>.asset        # solo mapas referenciados
  backup.json               # formato dnd-backup, version=1, schemaVersion=3
```

El manifiesto incluye identidad de storage, fecha, SHA-256 del archivo SQLite, cantidad de salas y metadatos/hash de cada imagen; no contiene rutas ni credenciales plaintext. Se publica exclusivamente al terminar todas las verificaciones, con hard link que no sobrescribe. Mientras exista `backup-in-progress`, la copia se rechaza. Su límite de manifiesto es 16 MiB. Un fallo deja una carpeta incompleta identificada y preserva la fuente, sin limpieza recursiva automática.

Restore valida formato, checksum, esquema, estado/acceso, referencias, binding y cada archivo antes de crear destino. Exige destino inexistente, padre existente y ubicación fuera de la copia; nunca sustituye datos previos. Copia los bytes de la instantánea **cerrada e inmutable** ya validada, sincroniza, copia mapas con los mismos IDs y verifica origen/destino de nuevo. No es una copia de la DB viva. La lease vacía permite arrancar el servidor restaurado aunque el original siga activo. No reaparecen sockets ni presencia.

`restore-in-progress` bloquea el arranque hasta completar verificación/publicación. Si hay error, conserva el destino incompleto para inspección: usa otro destino nuevo; no quites el marcador para intentar servir datos incompletos. Si falla una sincronización final, inspecciona y valida la ubicación antes de usarla. No edites ni arranques un servidor directamente sobre el bundle: trátalo como artefacto inmutable y restaura a otro lugar.

## Evidencia y matriz destructiva

Validación del 2026-10-07 en Windows x64: `npm ci → npm run build → npm test` terminó con código **0**, en **14 min 32 s** (21:15:56 a 21:30:29, UTC−06:00). Instala 32 paquetes; lockfile y dependencias permanecen iguales. TypeScript 7.0.2 y Vite 8.1.5 pasan. Los filtros históricos de perfiles permanecen; entre los casos descubiertos no hay omitidos, cancelados ni reintentos.

| Suite Node 24.21.0 | Ejecutados | Aprobados | Fallidos | Omitidos | Tiempo |
| --- | ---: | ---: | ---: | ---: | --- |
| Unidades y arquitectura | 134 | 134 | 0 | 0 | 8.34 s |
| Integración HTTP/WebSocket/procesos | 30 | 30 | 0 | 0 | 9.97 s |
| E2E local, seis perfiles | 266 | 266 | 0 | 0 | 12.8 min |
| Multijugador, tres perfiles | 13 | 13 | 0 | 0 | 1.1 min |
| **Total de casos distintos** | **443** | **443** | **0** | **0** | Workflow: 14 min 32 s |

Durante la revisión se corrigió la contención de nombres como `..copies` (commit `7512971`), que no son el segmento padre `..`. Después de esa corrección se repitieron **134 unidades/arquitectura (9.17 s), 30 integraciones (9.99 s) y el build**, todos con código 0 y sin omitidos/cancelados. No se modificaron frontend, reglas ni protocolo. Los comandos reales `server/storage.ts backup/restore` también pasaron con una sala, revisión 1 y los 9844 bytes del mapa recuperados.

Compatibilidad adicional con el binario oficial Node **22.18.0**: **134/134 unidades** en 10.28 s y **30/30 integraciones** en 11.09 s, cero omitidas/canceladas. Tras la corrección de rutas pasaron sus **13/13 casos de backup/configuración** en 7.36 s. Estas repeticiones están incluidas conceptualmente en los casos anteriores y no aumentan el total 443. Los procesos hijos usan `process.execPath`, por lo que los reinicios y la restauración realmente se ejecutaron con Node mínimo.

Logs locales de ejecución: `dnd-phase-b-final.log`, `dnd-phase-b-path-final-unit.log`, `dnd-phase-b-path-final-integration.log`, `dnd-phase-b-last-build.log`, `dnd-phase-b-node22-final-unit.log`, `dnd-phase-b-node22-final-integration-confirm.log`, `dnd-phase-b-node22-path.log` y `dnd-phase-b-cli.log`, en el directorio temporal del host. La ejecución Node 22 fallida se conserva en `dnd-phase-b-node22-final-integration.log` y se describe en riesgos; sus repeticiones no borran ese antecedente. Los logs/artefactos generados no se versionan. Avisos: colores `NO_COLOR`/`FORCE_COLOR` y SQLite experimental en Node mínimo; no se observó warning de compilación ni error de consola en la matriz final.

Pruebas nuevas principales: `sqliteRoomStore`, `durableRooms`, `filesystemAssetStore`, `durableMaps`, `backup`, `storageConfig`; integración `durableTransport`, `persistenceRestart`, `backupRestore`, `development`. Los tests usan directorios temporales propios y procesos nuevos, sin datos valiosos ni variables globales compartidas como evidencia de recuperación.

| Fallo / escenario | Resultado esperado y comprobado |
| --- | --- |
| Lectura/inicio/escritura estado/privados/commit, ENOSPC/EACCES simulados | Datos y versiones previas; sin éxito/broadcast anticipado |
| Excepción tras COMMIT con recibo | Un único cambio confirmado, sin rechazo falso ni replay |
| Reconciliación/rollback indisponible | Cuarentena; reapertura recupera estado realmente confirmado |
| Writer independiente / CAS obsoleto | BUSY/CONFLICT; conserva parches y altas con revisión de board sin incremento |
| Directorio/junction sustituido, traversal, colisión, hard link externo | Rechazo; conserva archivos originales/ajenos |
| Escritura parcial/sync/publicación/preparación de mapa | Referencia/bytes/credenciales/revisión anteriores; huérfano recuperable |
| Borrado/cleanup posterior denegado | Commit nuevo sigue exitoso; mantenimiento posterior termina sin pérdida |
| Referencia ausente/corrupta, archivo desconocido | No borra ante corrupción; preserva desconocidos |
| SIGKILL antes de preparar, durante escribir, tras preparar y antes de commit | Proceso nuevo recupera último mapa confirmado, sin temporales/huérfanos administrados |
| SIGKILL tras commit y antes de cleanup | Proceso nuevo conserva mapa nuevo y elimina solo el antiguo sin referencia |
| V1/V2, migración interrumpida, corrupción y versión futura | Migración válida conserva datos; interrupción revierte; corrupción/futuro se rechazan |
| Backup snapshot/copia/publicación fallidos | Fuente intacta; bundle marcado incompleto, no restaurable |
| Restore snapshot/mapa/verificación/publicación fallidos | Copia intacta; destino marcado y arranque bloqueado; otro destino permite restaurar |
| Backup → mutación original → restore → proceso nuevo | Recupera exactamente board/revisión/accesos/mapa del backup; no cambios posteriores |

El escenario completo DM + dos jugadores atraviesa procesos Node diferentes con cierre normal y abrupto: fichas, asignaciones, movimientos, niebla, Solo DM, revisión, geometría y bytes; rechaza autoridad ajena, conserva IDs originales y no filtra secretos. La prueba de restore mantiene vivo el original, modifica después su revisión 6 a 9 y comprueba que el nuevo proceso recupera 6 y el mapa antiguo. El test de desarrollo comprueba el launcher real, HTTP/WebSocket por Vite y estado SQLite.

## Límites y riesgos residuales

- **Alta, operacional:** pérdida de credenciales del navegador sigue sin recuperación por cuenta; backup no recupera plaintext. ACL/directorios y copias deben quedar bajo control del operador. Un proceso hostil bajo la misma cuenta Windows no queda aislado por Node; no usar almacenamiento compartido no confiable.
- **Media:** Linux ARM64, cortes físicos, reinicio real de VM y filesystem de red no ejecutados. Sin garantía absoluta de energía o atomicidad filesystem/SQLite. Un servidor por DB, IO síncrono y bloqueo de backup pueden limitar disponibilidad. PID reutilizado puede requerir inspección de lease.
- **Media:** `commit_receipts` y salas durables no tienen retención/compactación automática; vigilar espacio y hacer backups manuales. Una corrupción detiene servicio conservadoramente. La API SQLite de Node mínimo sigue en desarrollo activo.
- **Media, evidencia:** una ejecución Node 22.18 con unidades e integración simultáneas terminó con 26/29 integraciones aprobadas, tres timeouts (HTTP, cierre de proceso, heartbeat), cero omitidas y código 1 en 20.945 s. Repeticiones de integración sin esa carga pasaron; no se identificó un defecto de datos como causa. Se conserva el resultado fallido, sin sustituirlo por una afirmación de estabilidad absoluta.
- **Baja / fuera de esta validación:** los navegadores móviles están emulados, no probados físicamente. Persisten los límites de seguridad de v0.0.4: mapa completo disponible, niebla visual, sin HTTPS público/hardening nuevo.

No se implementó Cloudflare, Oracle, cuentas, escenas/campañas nuevas, chat, combate, reglas nuevas, jobs ni despliegue. La auditoría independiente de B y cualquier siguiente fase requieren otra tarea.
