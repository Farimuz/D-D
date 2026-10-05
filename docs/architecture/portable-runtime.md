# Arquitectura portable de runtime

Este documento describe el diseño vivo derivado de la decisión [0003 — Núcleo portable con adaptadores de infraestructura](../decisions/0003-portable-core-infrastructure-adapters.md).

No es una especificación inmutable. Debe actualizarse cuando la implementación real cambie.

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

Primero: SQLite.

### Assets

Responsable de:

- bytes;
- metadatos técnicos;
- lectura;
- reemplazo;
- eliminación.

Primero: filesystem.

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

## Definición de éxito para v0.0.5

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
