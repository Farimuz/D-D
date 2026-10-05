# 0003 — Núcleo portable con adaptadores de infraestructura

- **Estado:** Aceptada
- **Fecha:** 2026-10-05
- **Tipo:** Arquitectura / despliegue / mantenibilidad

## Contexto

D&D ya dispone de un backend Node/TypeScript con HTTP y WebSocket para salas multijugador. En v0.0.4 las salas todavía viven principalmente en memoria y no existe todavía una arquitectura de persistencia permanente.

Al evaluar el siguiente paso aparecieron dos alternativas especialmente útiles:

- una VM tradicional, inicialmente una instancia Oracle Cloud Always Free ya disponible, ejecutando Node, SQLite y archivos locales;
- una arquitectura serverless basada en Cloudflare Workers, Durable Objects y R2.

Ambas son técnicamente válidas pero tienen modelos de ejecución muy diferentes.

Una VM tradicional permite ejecutar el servidor Node actual casi directamente, utilizar almacenamiento local y conservar gran control sobre el sistema. Cloudflare puede reducir mucho el mantenimiento operativo y su modelo de Durable Objects encaja naturalmente con una sala autoritativa, pero requiere adaptar el backend a APIs y ciclo de vida específicos del proveedor.

También es razonable esperar que en el futuro aparezcan otros proveedores, frameworks o runtimes que resulten más convenientes.

El proyecto no debe quedar atado innecesariamente a la primera infraestructura persistente elegida.

## Decisión

D&D adoptará una arquitectura donde el **núcleo de dominio sea independiente del proveedor de infraestructura** y las capacidades que realmente varían se conecten mediante adaptadores pequeños.

La primera implementación persistente de producción podrá utilizar **Node + SQLite + almacenamiento de archivos**, inicialmente desplegable en Oracle o cualquier VM/VPS compatible.

Cloudflare no tiene que implementarse al mismo tiempo. Debe ser posible añadir posteriormente un adaptador basado en Workers + Durable Objects + R2 sin reescribir las reglas, permisos, acciones o proyecciones del juego.

La decisión es:

> **Construir un sistema portable, no mantener dos sistemas completos desde el principio.**

## Objetivos

Esta arquitectura busca:

- evitar vendor lock-in innecesario;
- conservar el servidor Node actual como opción local y self-hosted;
- poder cambiar de proveedor sin reescribir el dominio;
- permitir que Oracle, Cloudflare u otra infraestructura futura sean implementaciones reemplazables;
- facilitar pruebas unitarias del comportamiento de una sala sin servidor real;
- preparar el futuro motor de reglas para existir independientemente de HTTP, WebSocket, almacenamiento o frontend;
- mantener una ruta sencilla de despliegue para un grupo pequeño;
- evitar sobrearquitectura prematura.

## Principio de dependencias

El núcleo puede definir lo que necesita de la infraestructura.

La infraestructura puede depender del núcleo.

El núcleo **no** debe depender de una implementación concreta.

Conceptualmente:

```text
                 D&D CORE
┌────────────────────────────────────┐
│ salas                              │
│ acciones                           │
│ permisos                           │
│ proyección DM / jugador            │
│ validación                         │
│ reglas futuras                     │
└────────────────┬───────────────────┘
                 │
              puertos
        ┌────────┼─────────┐
        │        │         │
 persistencia  assets   realtime
        │        │         │
        └────────┼─────────┘
                 │
             adaptadores
          /                 \
 Node / VM                    Cloudflare
 SQLite                       Durable Objects
 filesystem                   R2
 ws                           DO WebSockets
```

## Qué pertenece al núcleo

Debe tender a vivir fuera de cualquier runtime concreto:

- modelo de estado de una sala;
- acciones válidas;
- validación semántica;
- permisos;
- asignación de fichas;
- proyección de datos para DM y jugadores;
- reglas de visibilidad;
- transformación de estado;
- invariantes;
- lógica de reconexión que no dependa del transporte cuando sea posible;
- en el futuro, dados, iniciativa, HP, combate, efectos, hechizos y demás reglas.

Una función de dominio debería poder probarse sin levantar:

- Node;
- Oracle;
- Cloudflare;
- WebSocket;
- HTTP;
- SQLite;
- React.

## Qué pertenece a infraestructura

Debe permanecer fuera del núcleo:

- abrir puertos HTTP;
- aceptar conexiones WebSocket;
- `ws.send()`;
- `process.env`;
- señales del proceso;
- acceso directo a filesystem;
- consultas SQL concretas;
- Durable Object APIs;
- R2 bindings;
- configuración de TLS;
- detalles de hibernación;
- configuración específica del proveedor.

## Fronteras que sí sabemos que pueden variar

No se abstraerá todo.

Por ahora existen cuatro fronteras justificadas:

1. **Persistencia de estado**
2. **Almacenamiento de assets**
3. **Transporte/realtime**
4. **Runtime y ciclo de vida**

Solo se introducirán interfaces cuando haya una necesidad concreta en esas fronteras.

No se crearán capas genéricas para características que todavía no existen.

## Persistencia

El núcleo debe trabajar contra una capacidad conceptual equivalente a cargar y guardar una sala.

Ejemplo no normativo:

```ts
interface RoomStore {
  load(roomId: string): Promise<RoomState | null>
  save(room: RoomState): Promise<void>
  delete(roomId: string): Promise<void>
}
```

La API real puede ser diferente si los requisitos de concurrencia o transacciones lo justifican.

### Primera implementación

Node/VM:

```text
RoomStore
    ↓
SQLite
```

### Implementación futura posible

Cloudflare:

```text
RoomStore
    ↓
Durable Object storage / SQLite
```

## Assets

Los mapas y futuros assets binarios no deben formar parte del estado JSON principal ni quedar acoplados al filesystem.

Debe existir una frontera conceptual para:

- almacenar;
- recuperar;
- reemplazar;
- borrar;
- conocer metadatos.

Primera implementación:

```text
AssetStore
    ↓
filesystem
```

Cloudflare futuro:

```text
AssetStore
    ↓
R2
```

La base de datos debe guardar referencias estables y metadatos, no asumir una ruta física específica como parte del modelo de dominio.

## Realtime

El núcleo no debe llamar directamente a una librería WebSocket.

Debe producir un resultado o evento que la capa de transporte pueda distribuir.

Conceptualmente:

```text
acción
  ↓
core
  ↓
nuevo estado + eventos
  ↓
adaptador realtime
  ↓
clientes
```

Node puede seguir usando `ws`.

Cloudflare podrá utilizar WebSockets de Durable Objects.

Un proveedor futuro podrá usar otra implementación.

## Modelos de ejecución diferentes

No se intentará fingir que Node y Durable Objects son el mismo runtime.

Node puede ejecutar:

```text
1 proceso
  ↓
muchas salas
```

Cloudflare puede ejecutar naturalmente:

```text
1 Durable Object
  ↓
1 sala
```

Ambos pueden compartir el mismo núcleo aunque su ciclo de vida sea distinto.

La abstracción debe conservar capacidades de dominio, no copiar artificialmente las APIs de un proveedor en el otro.

## Concurrencia y serialización

Una sala autoritativa debe aplicar sus acciones en un orden coherente.

La infraestructura debe garantizar que dos acciones concurrentes no corrompan el estado.

Node podrá necesitar:

- cola o exclusión por sala;
- transacción de SQLite cuando corresponda;
- revisión/versionado para detectar cambios.

Durable Objects ofrecen un modelo diferente, pero el adaptador seguirá siendo responsable de respetar la misma invariante.

El núcleo no debe asumir que por estar actualmente en un único proceso nunca habrá concurrencia.

## Persistencia y assets deben ser consistentes

Operaciones como reemplazar un mapa afectan:

- bytes del asset;
- metadatos de la sala.

Debe evitarse dejar referencias a assets inexistentes o perder el asset anterior si una escritura falla.

La implementación debe conservar el patrón ya utilizado en versiones locales:

1. validar;
2. preparar el nuevo asset;
3. actualizar la referencia de forma controlada;
4. eliminar lo anterior solo cuando el nuevo estado sea válido;
5. poder recuperarse de fallos intermedios.

No se exige una transacción distribuida completa, pero sí una estrategia explícita de consistencia y recuperación.

## Identidades, IDs y tiempo

Los datos persistentes no deben incorporar identificadores que solo tengan sentido dentro de un proveedor.

Room IDs, token IDs, participant IDs, asset IDs y futuras entidades deben utilizar formatos portables.

Las reglas de dominio no deben depender directamente del reloj del sistema cuando el tiempo influya en una decisión importante. Si aparecen expiraciones, turnos temporizados o tareas programadas, se introducirá una frontera de reloj/scheduler cuando exista la necesidad real.

## Protocolo versionado

El protocolo cliente-servidor debe continuar separado del runtime.

Los mensajes deben:

- tener contratos explícitos;
- validarse en el borde;
- poder versionarse;
- evitar exponer objetos internos de una base de datos o de Durable Objects.

Cambiar de alojamiento no debe obligar a cambiar el protocolo de juego salvo que exista una mejora deliberada.

## Migraciones

Desde que exista persistencia permanente:

- los esquemas tendrán versión;
- las migraciones serán explícitas;
- un cambio de almacenamiento no debe implicar perder campañas;
- debe existir una forma de exportar o respaldar datos.

Si en el futuro se migra de Oracle a Cloudflare, o al revés, la información de dominio debe ser exportable sin depender del formato privado de un proveedor.

## Seguridad

La separación de infraestructura no reduce las obligaciones de seguridad.

Cada adaptador debe preservar como mínimo:

- servidor autoritativo;
- validación de mensajes;
- separación DM/jugador;
- secretos no enviados al cliente incorrecto;
- límites de tamaño;
- límites de recursos;
- nombres/datos no interpretados como HTML activo;
- protección adecuada de assets;
- HTTPS/WSS en producción.

Las decisiones de seguridad deben expresarse como invariantes del sistema cuando sea posible, no como accidentes de una implementación.

## Configuración de límites

Límites como:

- jugadores por sala;
- fichas;
- regiones de niebla;
- tamaño de mapas;
- tamaño de mensajes;

deben definirse en un lugar claro y portable.

Un adaptador puede imponer límites adicionales por su proveedor, pero el dominio debe conocer sus propias restricciones válidas.

## Observabilidad

No se construirá todavía una plataforma genérica de observabilidad.

Sí se mantendrá la posibilidad de emitir logs y métricas estructuradas desde infraestructura sin introducir dependencias de un proveedor dentro del core.

Errores de dominio deben distinguirse de errores de infraestructura.

## Pruebas

La portabilidad debe demostrarse, no solamente declararse.

Se favorecerán tres niveles:

### Core

Pruebas puras para:

- acciones;
- permisos;
- proyecciones;
- reglas;
- invariantes.

### Adaptadores en memoria

Implementaciones sencillas como:

- MemoryRoomStore;
- MemoryAssetStore;
- FakeRealtime.

Permiten ejecutar flujos completos sin servicios externos.

### Adaptadores reales

Pruebas de integración específicas para:

- SQLite/filesystem/Node;
- Cloudflare cuando exista;
- cualquier proveedor futuro.

No es necesario ejecutar toda la matriz de navegador contra todos los backends en cada cambio. Debe existir una estrategia razonable que evite duplicar innecesariamente el coste de pruebas.

## Primera plataforma de producción

La primera ruta persistente recomendada es:

```text
Node
 + SQLite
 + filesystem
        ↓
Oracle / VM / VPS / PC
```

Oracle es una primera ubicación, no una dependencia arquitectónica.

La misma implementación Node debe poder ejecutarse razonablemente en otra máquina Linux o servidor propio.

## Cloudflare

Cloudflare se mantiene como una implementación futura especialmente interesante:

```text
Worker
 + Durable Object por sala
 + DO storage/SQLite
 + R2 para assets
```

No es un requisito de v0.0.5 que Cloudflare tenga paridad funcional con Node.

Cuando se implemente, deberá reutilizar el core y respetar sus invariantes.

Si para soportar Cloudflare fuera necesario modificar grandes partes del dominio, eso será una señal de que las fronteras no quedaron correctamente definidas.

## Self-hosting

Conservar el adaptador Node permite que D&D pueda seguir siendo self-hostable.

Un usuario debería poder, en el futuro, desplegar:

```text
D&D Node server
 + SQLite
 + assets
```

sin depender del servicio público oficial.

No es necesario crear todavía una experiencia de instalación de un clic, pero la arquitectura no debe cerrar esa posibilidad.

## Futuro motor de reglas

Esta decisión es especialmente importante para la visión de reglas extensibles.

El futuro motor de:

- dados;
- HP;
- iniciativa;
- ataques;
- tipos de daño;
- resistencias;
- vulnerabilidades;
- condiciones;
- hechizos;
- criaturas;
- contenido personalizado;

debe vivir en el core.

Ejemplo:

```text
resolveAttack(...)
```

debe poder probarse sin servidor ni navegador.

Oracle o Cloudflare únicamente persistirán y transmitirán los resultados necesarios.

## Regla contra la sobrearquitectura

La portabilidad no justifica diseñar para tecnologías imaginarias.

Se aplicará este criterio:

> **Abstraer únicamente las fronteras que sabemos que pueden variar o que ya dificultan las pruebas.**

No se crearán interfaces por costumbre.

No se buscará un "mínimo común denominador" que impida aprovechar capacidades útiles de cada runtime.

Un adaptador puede optimizarse para su plataforma mientras mantenga las mismas invariantes de dominio.

## Coste aceptado

Mantener el core portable añade algo de disciplina y una pequeña cantidad de trabajo adicional:

- respetar las fronteras;
- implementar adaptadores;
- añadir pruebas de contratos.

Ese coste se acepta porque también mejora testabilidad y separación de responsabilidades aunque solo exista un backend.

Lo que **no** se acepta como obligación es mantener desde ahora dos backends de producción completos.

Si en el futuro Node y Cloudflare se consideran ambos oficialmente soportados, cada uno tendrá un coste adicional de implementación y pruebas que deberá justificarse por su utilidad.

## Consecuencias para v0.0.5

v0.0.5 debe priorizar:

1. extraer del servidor actual la lógica de dominio que todavía esté acoplada a Node/`ws`;
2. definir solo los puertos mínimos necesarios;
3. conservar el comportamiento y seguridad de v0.0.4;
4. añadir adaptadores en memoria para pruebas;
5. implementar persistencia real con SQLite;
6. implementar assets persistentes sobre filesystem;
7. garantizar recuperación tras reinicio;
8. hacer que el servidor Node sea desplegable en una VM sin convertir la VM en parte del dominio;
9. documentar migraciones, backups y recuperación;
10. mantener preparado el punto de extensión para Cloudflare, sin exigir implementarlo todavía.

## Criterios de revisión

Revisar esta decisión si:

- mantener las fronteras comienza a añadir complejidad mayor que su beneficio;
- un futuro runtime requiere capacidades incompatibles con las invariantes actuales;
- la experiencia demuestra que solo existirá razonablemente un entorno de ejecución;
- aparecen requisitos de escala o seguridad que obligan a cambiar el modelo autoritativo.

Hasta entonces:

> **El producto vive en el core. El proveedor de infraestructura es un adaptador reemplazable.**
