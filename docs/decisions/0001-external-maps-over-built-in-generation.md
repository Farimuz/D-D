# 0001 — Priorizar juego e integración con mapas externos sobre generación propia

- **Estado:** Aceptada
- **Fecha:** 2026-10-04
- **Tipo:** Producto / arquitectura / roadmap

## Contexto

Una de las ideas iniciales de D&D era facilitar mucho la creación de espacios y, eventualmente, generar mapas propios de forma procedural o a partir de texto.

Durante las primeras versiones se construyó primero una mesa capaz de trabajar con mapas externos. La aplicación ya puede importar mapas, alinearlos con su cuadrícula, mover fichas, medir y aplicar herramientas del DM.

Al mismo tiempo, ya existe un ecosistema muy amplio de herramientas externas para crear mapas:

- herramientas manuales;
- generadores automáticos;
- generadores semiautomáticos;
- editores de battle maps;
- generadores de mazmorras;
- herramientas para tabernas, pueblos y ciudades;
- herramientas para regiones y continentes.

Intentar competir con todas ellas desviaría tiempo de la necesidad principal del proyecto: **tener una herramienta estable y cómoda para jugar remotamente con amigos desde PC y teléfono**.

## Decisión

La generación propia de mapas **deja de ser una prioridad del roadmap principal**.

D&D se enfocará primero en ser una buena herramienta para **jugar con mapas**, independientemente de dónde hayan sido creados.

La dirección principal será:

```text
herramientas externas
mapas descargados
mapas hechos a mano
generadores especializados
        ↓
       D&D
        ↓
importar → alinear → preparar → jugar
```

La generación de mapas propia permanece como una posibilidad futura, pero no debe condicionar las decisiones actuales de arquitectura ni consumir una parte importante del esfuerzo mientras existan necesidades más directas de juego.

## Consecuencias de producto

Se priorizan:

1. estabilidad;
2. experiencia cómoda en PC y teléfono;
3. multijugador;
4. reconexión y manejo de sesiones;
5. persistencia de partidas;
6. permisos y herramientas del DM;
7. manejo de varias escenas/mapas durante una sesión;
8. facilidad de importación y alineación;
9. interoperabilidad con herramientas externas;
10. mecánicas que hagan una partida real más cómoda.

La generación propia queda por debajo de estas prioridades.

## Consecuencias de diseño

### El mapa debe ser una entrada, no el centro de la arquitectura

El sistema debe tratar los mapas como assets que pueden venir de múltiples fuentes.

Las funciones principales de la mesa no deben depender de que el mapa haya sido creado por D&D.

### Importar bien tiene más valor inmediato que generar

Cuando haya que elegir entre mejorar un generador interno o mejorar:

- importación;
- alineación;
- escalado;
- metadatos;
- escenas;
- compatibilidad;

se favorecerá normalmente la segunda opción mientras mejore la experiencia real de juego.

### La arquitectura debe permanecer preparada para integraciones

Cuando sea razonable, D&D debería poder aprovechar información producida por herramientas externas, por ejemplo:

- dimensiones de cuadrícula;
- número de filas y columnas;
- resolución;
- metadatos de escena;
- paredes, puertas u otros datos estructurados si algún formato los proporciona.

Esto no obliga a soportar formatos concretos todavía. Es una guía para evitar diseñar el sistema como si todos los mapas fueran simples imágenes creadas internamente.

### No duplicar herramientas especializadas sin una necesidad real

No se invertirá esfuerzo importante en recrear editores de:

- continentes;
- ciudades;
- pueblos;
- tabernas;
- mazmorras;
- battle maps;

solo porque sea técnicamente posible.

Antes de construir algo así debe existir una fricción real y recurrente durante partidas que las herramientas externas no resuelvan suficientemente bien.

## Consecuencias para el roadmap

Después de las herramientas locales iniciales, el trabajo debe concentrarse principalmente en convertir D&D en una herramienta que pueda usarse de verdad durante sesiones remotas.

Dirección prevista, sujeta a nuevas pruebas:

- **v0.0.4:** multijugador básico;
- **v0.0.5:** despliegue y persistencia estable;
- **v0.0.6:** escenas / varios mapas y flujo de sesión;
- posteriores: mejoras de comodidad, herramientas de juego e integraciones según necesidades reales.

Estas versiones no constituyen un contrato rígido; expresan la prioridad resultante de esta decisión.

## Qué sí puede hacerse respecto a generación

La decisión no prohíbe permanentemente la generación de mapas.

Puede retomarse si las pruebas reales muestran un problema concreto, por ejemplo:

- se necesita improvisar habitaciones demasiado a menudo;
- encontrar un mapa adecuado interrumpe constantemente la sesión;
- una generación rápida de espacios simples resolvería una fricción importante;
- una integración con un generador externo no es suficiente.

En ese caso debe evaluarse una solución pequeña y dirigida al problema observado, no asumir que D&D necesita convertirse en una suite completa de creación de mapas.

## Criterio para revisar esta decisión

Revisar esta decisión únicamente si el uso real demuestra que la dependencia de mapas externos se convierte en una limitación importante para jugar.

Hasta entonces, el principio es:

> **D&D no pretende ser primero una herramienta de creación de mapas. Pretende ser una herramienta sencilla, estable y cómoda para jugar con ellos.**
