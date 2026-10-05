# Arquitectura portable de runtime

Este documento describe el diseño vivo derivado de la decisión [0003 — Núcleo portable con adaptadores de infraestructura](../decisions/0003-portable-core-infrastructure-adapters.md).

No es una especificación inmutable. Debe actualizarse cuando la implementación real cambie.

## Preparación de v0.0.5 — fase A

La base es `main` en `78e4b4f`, incluida la corrección de medición local para jugadores online. Antes de extraer el dominio se corrigió un defecto de aislamiento en los tests multijugador: los 13 casos acumulaban salas en un único servidor, cuyo límite de producción es 10. La fixture ahora abre y cierra un servidor en memoria por caso. Se conservan todos los escenarios y el límite del producto; esta corrección no cambia la aplicación.

## Implementación actual — fase A

La fase A de v0.0.5 extrae el dominio y conserva el comportamiento y protocolo de v0.0.4. Las salas, accesos y mapas siguen siendo temporales en memoria. Reiniciar Node todavía los pierde. No se incorporaron SQLite, filesystem persistente, despliegues ni funciones visibles.

### Estructura anterior y actual

| Antes | Ahora |
| --- | --- |
| `server/rooms.ts`: estado, permisos, mutaciones, proyecciones, crypto y conexiones | `src/core/room/{types,domain,validation}.ts`: estado neutral, acciones, permisos, mutaciones y proyecciones; `server/rooms.ts`: acceso y coordinación del runtime |
| `src/online/protocol.ts`: acciones de dominio y mensajes de transporte juntos | Core define acciones y estado; protocolo conserva envelopes, join, validación de mensajes y reexportaciones compatibles |
| `src/state/storage.ts`: validación y almacenamiento local juntos | `src/state/validation.ts`: validación pura; storage conserva carga/guardado del navegador y su API |
| `src/map/mapAsset.ts`: límites junto a decodificación del navegador | `src/map/limits.ts`: constantes neutrales; mapAsset conserva validación de Blob/imagen |
| Estado autoritativo en el objeto Node de sala | `src/core/room/store.ts`: contrato mínimo; `src/infrastructure/memory/roomStore.ts`: implementación en memoria |
| Mutación de metadata del mapa dentro del handler HTTP | HTTP autentica y valida bytes; core valida y reemplaza metadata; Node confirma estado y bytes antes de distribuir |

### Core y autoridad

`RoomState` contiene únicamente ID de sala, board compartido, revisión y participantes `{id, name}`. No contiene credenciales, hashes, sockets, bytes, cámara, zoom ni medición. Los participantes desconectados permanecen en ese estado para conservar asignaciones y contar hacia el límite de diez identidades.

`createRoomState` remapea IDs importados y limpia asignaciones. `registerParticipant` incorpora o renombra una identidad ya resuelta por el adaptador sin incrementar revisión. `applyAction` valida, comprueba permisos actuales y devuelve `{state, tokenId?}` o un `RoomError`; nunca modifica su entrada ni hace broadcast. Cada acción aceptada incrementa la revisión una vez. `replaceMap` es una operación interna sobre metadata validada, no una acción nueva del protocolo.

El adaptador entrega un actor autenticado y una función para generar IDs. El core comprueba que el participante pertenece a la sala; esta comprobación no sustituye la autenticación. Node conserva credenciales DM de 256 bits, hashes de identidad, comparación segura y enlace entre socket y actor. Ninguna acción del cliente puede elegir autoridad.

`projectRoom` recibe presencia calculada por el runtime y construye explícitamente los campos públicos de cada nivel, sin propagar campos extra del almacén. El DM obtiene todos los tokens y participantes; el jugador obtiene solo tokens públicos cuyo centro de casilla no esté cubierto por niebla, sin nombres de otros participantes ni datos de acceso. `server/rooms.ts` añade el envelope `type: 'state'` y `server/app.ts` distribuye el resultado.

### Almacén y consistencia actuales

`RoomStore` tiene solo `load(roomId)`, `save(state)` y `delete(roomId)`. Es síncrono en esta fase: guardar reemplaza el estado completo o falla sin alterarlo; save/delete devuelven `undefined` para que TypeScript rechace métodos Promise inadvertidos (el retorno `void` los admitía). Los datos que cruzan la frontera son JSON separado de los objetos internos del almacén. MemoryRoomStore copia al guardar y cargar. El objeto Node de sala ofrece lecturas de board/revisión desde ese almacén, sin mantener un segundo board autoritativo.

Las acciones se aplican al estado recién cargado. Node guarda antes de confirmar, actualizar actividad o emitir proyecciones. Devuelve el estado confirmado a transporte: broadcast y respuesta HTTP lo usan sin otra lectura que pueda convertir una escritura exitosa en un rechazo falso. Los parches conservan campos no modificados; gana la última acción válida procesada. Cargar, transformar, guardar y confirmar no tienen `await`, por lo que no se intercalan mutaciones en ese tramo del runtime actual. La garantía vive en el coordinador Node, no en `RoomStore`: dos escritores externos con lecturas antiguas pueden perder cambios. El contrato no incluye CAS ni admite un adaptador asíncrono sin adaptar la coordinación; el dominio puro permanece independiente de esa decisión.

Los IDs y geometría de mapas pertenecen al estado neutral; `ImageAsset {id, bytes, type}` sigue en el objeto Node de sala. HTTP mantiene firma/dimensiones, límite de 25 MiB, comprobaciones EXIF y exclusión de subidas simultáneas. Tras validar, core produce metadata nueva; Node guarda y sustituye los bytes en el mismo tramo síncrono. Si falla el guardado conforme al contrato, conserva metadata, bytes y revisión anteriores; libera el bloqueo y permite reintentar. Borrar mapa o resetear libera bytes solo después de guardar. La expiración llama a eliminación explícita; el cierre llama a `releaseRuntime()`, que libera conexiones, accesos y bytes del runtime sin llamar a `store.delete()`. Esto no implementa recuperación tras reinicio: faltan accesos y assets durables.

Un fallo de lectura o guardado anterior al commit no confirma una acción ni adelanta revisión. Las proyecciones de presencia leen una sola vez antes de distribuir; si falla, envían un error genérico `STORAGE` mediante el envelope existente y conservan el último snapshot. Fallos de expiración no terminan el heartbeat ni eliminan el registro/runtime; se reintentan en barridos posteriores. Un adaptador que escribe y luego lanza una excepción incumple el contrato: no puede garantizarse rollback desde la aplicación, ni debe interpretarse como un rechazo sin efectos. Fase B debe resolver estados de commit incierto dentro de infraestructura antes de comunicar un resultado.

### Qué permanece en Node

- HTTP, binarios, headers, rutas, puertos y lectura del frontend construido.
- WebSocket, sesiones, envío/broadcast, límites de frames, heartbeat y timeouts.
- Generación criptográfica de códigos/IDs y credenciales; hashes y autenticación.
- Presencia, recuentos de conexiones, reloj, inactividad de treinta minutos y ciclo de vida.
- Diez salas por proceso, cuatro conexiones por identidad/DM y 512 sockets; el core conserva los límites de diez participantes, 200 fichas, 1000 regiones y geometría válida de mapas.

No se creó un framework de realtime, contenedor de DI, event bus, ORM ni AssetStore anticipado.

### Pruebas de la extracción

Se añadieron once tests de core/memoria: escenario DM+A+B, permisos, entrada inmutable, revisiones, referencias inválidas, proyecciones, niebla/Solo DM, límites, cambios ordenados, mapas e independencia de referencias del almacén. El escenario se compila como bundle autocontenido y se ejecuta sin `process`, `require`, `Buffer`, WebSocket, APIs del navegador, red, crypto, reloj ni timers. La compilación rechaza dependencias externas en ese grafo.

Cuatro tests adicionales del adaptador verifican un RoomStore alternativo de JSON, fallos de guardado, limpieza y límites de conexiones. Dos tests HTTP/WebSocket reales comprueban rechazo sin broadcast/revisión y recuperación de un mapa tras fallo del almacén. Los escenarios anteriores se conservan; la fixture del test de mapa antiguo ahora usa la operación de reemplazo en vez de mutar una lectura separada del almacén.

La matriz mantiene 266 casos locales y 13 multijugador, incluida medición local del jugador en Chrome, Android e iPhone emulados. La evidencia de navegadores automatizados no acredita una prueba física en iOS/Android.

Evidencia histórica de la extracción, reportada el 2026-10-05 sobre `42e02ae`: `npm test` terminó con código 0 y conservó los 331 casos de la base, más 17 nuevos. No sustituye la [auditoría independiente y destructiva de fase A](phase-a-audit.md), que registra defectos, correcciones y una nueva ejecución completa.

| Suite | Casos aprobados |
| --- | ---: |
| Unidades, incluidos core y adaptadores | 60 |
| Integración HTTP/WebSocket | 9 |
| Compatibilidad local en seis perfiles | 266 |
| Multijugador en tres perfiles | 13 |
| **Total** | **348** |

Sin fallos; unidades/integración sin cancelados ni omitidos, y Playwright sin reintentos. Los tres casos finales de medición de jugador pasaron. `npm run build` posterior también terminó con código 0 (TypeScript y Vite). Solo apareció el aviso ambiental de `NO_COLOR`/`FORCE_COLOR`; las comprobaciones de consola de la suite pasaron. La revisión confirmó validadores idénticos a la base, ausencia de dependencias de runtime en el grafo del core y ningún cambio en UI, protocolo observable o dependencias instaladas.

### Pendiente para la fase B

Implementar SQLite para estado y metadata de acceso privada del adaptador, más assets persistentes en filesystem. El contrato RoomStore solo cubre RoomState, incluidas referencias de mapa mediante ID y geometría. Hashes DM/jugador, actividad y bytes siguen fuera de ese estado: también deben recuperarse tras reinicio sin entrar en proyecciones.

Definir esquema versionado y validación al cargar, transacciones y orden por sala (especialmente si se adopta IO asíncrono), publicación de assets por archivo temporal/rename y recuperación explícita de fallos entre archivo y referencia. Eliminar el asset anterior solo tras confirmar la nueva referencia. Añadir reinicio real, subidas interrumpidas, fallo de disco, huérfanos, migraciones, backup y restauración a las pruebas. Mantener separado cierre de runtime y borrado de dominio, y decidir explícitamente la política de expiración durable. La revisión del board no cambia al registrar/renombrar participantes: por sí sola no es una versión de CAS para todo `RoomState`.

Las secciones siguientes conservan la dirección aprobada para v0.0.5 completa. SQLite, filesystem y recuperación tras reinicio son objetivos pendientes de la fase B, no capacidades construidas en la fase A.

## Objetivo

D&D debe poder evolucionar sin que Oracle, Cloudflare, `ws`, SQLite, filesystem u otra tecnología de infraestructura se conviertan en el lugar donde vive la lógica del juego.

La primera implementación persistente será Node sobre una máquina tradicional. La arquitectura debe permitir añadir otros runtimes posteriormente.

## Regla principal

```text
domain/core
    ↓ define necesidades
ports/contracts
    ↑ implementados por
infrastructure/adapters
```

Nunca al revés.

## Dependencias permitidas

### Core puede depender de

- tipos y utilidades internas neutrales;
- contratos de dominio;
- puertos definidos por el propio core;
- funciones puras.

### Core no debe depender de

- Node HTTP;
- `ws`;
- SQLite driver;
- filesystem;
- Durable Objects;
- R2;
- variables de entorno;
- procesos o señales;
- React.

### Adaptadores pueden depender de

- core;
- librerías de infraestructura;
- configuración del runtime.

## Separaciones iniciales

### Room/domain

Responsable de:

- estado;
- acciones;
- permisos;
- validación semántica;
- proyecciones;
- revisiones/invariantes.

### Room persistence

Responsable de:

- recuperar una sala;
- guardar cambios durables;
- eliminar;
- migrar esquemas.

Primera implementación persistente prevista: SQLite (fase B).

### Assets

Responsable de:

- bytes;
- metadatos técnicos;
- lectura;
- reemplazo;
- eliminación.

Primera implementación persistente prevista: filesystem (fase B).

### Realtime

Responsable de:

- conexiones;
- handshake de transporte;
- enviar eventos;
- broadcast;
- heartbeat/reconexión en la capa correspondiente.

Primero: `ws`.

## Flujo esperado de una acción

```text
cliente
  ↓
transporte valida forma básica
  ↓
identidad autenticada
  ↓
core aplica permisos + reglas
  ↓
resultado de dominio
  ↓
persistencia
  ↓
proyecciones DM/jugador
  ↓
realtime distribuye
```

La infraestructura no debe decidir reglas de juego mediante condicionales dispersos.

## Estado autoritativo

Debe existir una única versión autoritativa de la sala.

La cámara, zoom, selección, medición local y otros datos de UI siguen siendo locales cuando no formen parte de la partida compartida.

Las proyecciones del jugador se derivan del estado autoritativo; no constituyen una segunda sala.

## Concurrencia

Cada sala debe procesar mutaciones de forma consistente.

En Node, la implementación deberá definir explícitamente cómo serializa acciones por sala y cómo coordina la escritura SQLite.

En Durable Objects, el adaptador aprovechará su modelo de ejecución sin trasladar APIs específicas al dominio.

## Persistencia

El estado durable debe sobrevivir:

- reinicio del proceso;
- reinicio de la VM;
- despliegue de una nueva versión compatible.

No debe depender de caches en memoria.

La memoria puede utilizarse como cache, nunca como única fuente de verdad para datos persistentes.

## Versionado

Desde la primera persistencia permanente se requiere:

- schema version;
- migraciones explícitas;
- compatibilidad controlada;
- backup antes de migraciones destructivas;
- tests de migración.

## Exportabilidad

Se debe conservar la posibilidad de exportar una campaña/sala a un formato neutral.

No hace falta diseñar el formato final en v0.0.5, pero ningún dato esencial debe existir exclusivamente como estructura opaca del proveedor.

## Assets

El modelo de dominio referencia assets mediante ID y metadatos necesarios.

No debe guardar:

- rutas absolutas del servidor;
- URLs permanentes específicas del proveedor;
- handles privados del runtime.

La capa HTTP puede construir URLs temporales o públicas según el adaptador.

## Fallos

Deben distinguirse:

- error de dominio: acción inválida/no permitida;
- error de persistencia;
- error de asset;
- error de transporte.

Un error de infraestructura no debe convertirse silenciosamente en una mutación parcial.

## Operaciones críticas

Para operaciones con estado + asset:

```text
validar
→ escribir/preparar asset
→ persistir referencia
→ confirmar
→ limpiar asset anterior
```

Debe existir compensación o recuperación si una etapa falla.

## Credenciales

Credenciales de DM e identidades de participante son conceptos del sistema, pero:

- hashes;
- almacenamiento;
- cookies/localStorage;
- cabeceras HTTP;
- secretos del proveedor;

pertenecen al borde correspondiente.

No almacenar secretos de acceso en logs.

## Configuración

Configuración de despliegue debe llegar desde la infraestructura.

Ejemplos:

- puerto;
- ubicación de DB;
- directorio de assets;
- dominio público;
- límites adicionales.

El core puede definir límites del producto, pero no debe leer `process.env`.

## Adaptadores de referencia

### Memory

Uso:

- unit/integration tests;
- simulación;
- desarrollo de dominio.

### Node

Tecnologías iniciales:

- Node/TypeScript;
- HTTP;
- `ws`;
- SQLite;
- filesystem.

Debe funcionar en:

- desarrollo local;
- PC/LAN;
- Oracle;
- VPS Linux razonable.

### Cloudflare futuro

Posible mapeo:

- Worker para routing;
- Durable Object por sala;
- storage/SQLite del DO para estado;
- WebSocket Hibernation API;
- R2 para mapas/assets.

No hay compromiso de fecha ni de paridad inmediata.

## Qué no abstraer todavía

No crear de forma anticipada:

- sistema universal de jobs;
- event bus distribuido;
- ORM multi-proveedor;
- capa genérica para cualquier base de datos;
- plugin framework;
- DI container complejo;
- microservicios;
- interfaces para mecánicas que todavía no existen.

## Pruebas mínimas de portabilidad

Un flujo de sala debe poder probarse con adaptadores en memoria:

1. crear sala;
2. unir DM;
3. unir jugador;
4. crear ficha;
5. asignarla;
6. moverla;
7. aplicar niebla;
8. comprobar proyección;
9. guardar;
10. recargar estado;
11. obtener el mismo resultado observable.

La implementación Node debe ejecutar el mismo conjunto conceptual contra sus adaptadores reales.

## Definición de éxito para v0.0.5 completa (fases A + B)

La arquitectura se considerará suficientemente desacoplada cuando:

- permisos/proyecciones no importen `ws`;
- lógica de acciones no importe SQLite ni filesystem;
- reemplazar un RoomStore en tests no requiera cambiar dominio;
- assets tengan un contrato claro;
- reiniciar Node preserve una sala;
- los tests del core no necesiten red;
- desplegar Node en otra VM no requiera cambios de reglas;
- un futuro adaptador Cloudflare tenga un punto claro donde conectarse.

## Nota sobre estructura de carpetas

Una posible dirección es:

```text
src/
  core/
    room/
    permissions/
    projection/
    validation/

  infrastructure/
    memory/
    node/
      sqlite/
      filesystem/
      websocket/

  online/
    protocol/

server/
  node/
```

Si más adelante el tamaño lo justifica puede evolucionar a paquetes separados.

No reorganizar archivos únicamente para que coincidan con este dibujo. La estructura debe seguir al código real.
