# 0002 — Visión de D&D como sistema completo, accesible y extensible

- **Estado:** Aceptada
- **Fecha:** 2026-10-04
- **Tipo:** Visión de producto / arquitectura / UX / reglas

## Contexto

D&D nació para resolver una necesidad concreta: jugar a distancia con amigos de forma cómoda desde PC o teléfono, sin depender de VTT complejos ni de una combinación incómoda de herramientas.

A medida que el proyecto crezca, existe el riesgo de terminar construyendo solamente una mesa virtual que muestre mapas y fichas. Esa no es la visión final.

La intención es que D&D evolucione hasta convertirse en un **sistema de juego completo**, fácil de utilizar tanto por personas nuevas como por jugadores y Dungeon Masters experimentados, capaz de cubrir desde las necesidades más básicas de una partida hasta mecánicas avanzadas y contenido completamente personalizado.

Esta decisión establece esa visión como una dirección histórica del proyecto. No implica que todas estas funciones deban implementarse inmediatamente ni en una sola versión.

## Decisión

D&D debe evolucionar hacia una plataforma que permita jugar una partida completa a distancia **sin depender de otras herramientas para las funciones esenciales de juego**.

El sistema debe ser:

- sencillo de aprender;
- cómodo en PC y teléfono;
- útil para jugadores nuevos;
- eficiente para usuarios experimentados;
- suficientemente automatizado para reducir trabajo repetitivo;
- suficientemente flexible para no limitar personajes, reglas o contenido personalizado;
- extensible sin obligar a adaptar ideas nuevas a modelos rígidos o artificiales.

La meta no es solamente reproducir una mesa física.

La meta es que el sistema comprenda suficientes conceptos del juego como para ayudar activamente durante la partida sin convertirse en una barrera.

## Principio de autosuficiencia

Las funciones esenciales de una partida deben existir dentro de D&D.

Como mínimo, características fundamentales como:

- dados;
- puntos de golpe;
- iniciativa;
- fichas y personajes;
- movimiento y distancias;
- gestión básica de combate;
- estados y recursos esenciales;

no deben depender de servicios externos.

Las integraciones con otras herramientas pueden existir y ser útiles, pero deben ser **opcionales**.

Una caída, cambio de precio o desaparición de un servicio externo no debería impedir jugar una partida básica con D&D.

## Complejidad progresiva

La potencia del sistema no debe convertirlo en una herramienta difícil de aprender.

La interfaz debe seguir un principio de **complejidad progresiva**:

```text
persona nueva
    ↓
acciones simples y comprensibles
    ↓
automatización útil
    ↓
opciones avanzadas cuando hacen falta
    ↓
personalización profunda para quien la necesita
```

Una persona nueva no debería necesitar entender toda la arquitectura de reglas para:

- tirar un dado;
- atacar;
- lanzar un hechizo;
- mover su personaje;
- recibir daño;
- consultar su HP.

Una persona experimentada, en cambio, debe poder acceder a controles y configuraciones más profundas sin que el sistema le impida jugar como quiere.

## Automatización útil, no restrictiva

Las automatizaciones deben reducir explicaciones, cálculos y mediciones repetitivas.

Ejemplos de dirección deseada:

- seleccionar un arma y atacar sin reconstruir manualmente cada cálculo;
- aplicar correctamente resistencias, vulnerabilidades y modificadores;
- conocer propiedades relevantes del arma o tipo de daño;
- utilizar hechizos desde un libro de hechizos integrado;
- resolver alcance, áreas, objetivos y recursos de forma cómoda;
- aplicar efectos y condiciones sin tener que recordar cada interacción manualmente.

El objetivo es que el sistema ayude con las reglas que conoce.

Sin embargo, una automatización nunca debe convertirse en una prisión para contenido válido que el sistema todavía no conozca.

## Combate dinámico

El combate debe poder evolucionar más allá de un contador de HP.

La arquitectura debe estar preparada para representar interacciones como:

- tipos de daño;
- resistencias;
- vulnerabilidades;
- inmunidades;
- propiedades de armas;
- condiciones;
- modificadores;
- recursos;
- duración de efectos;
- objetivos;
- áreas;
- tiradas;
- salvaciones;
- efectos sobre aliados o enemigos;
- reglas dependientes del contexto.

Ejemplo conceptual:

```text
ataque
  ↓
arma
  ↓
tipo de daño
  ↓
objetivo
  ↓
resistencia / vulnerabilidad / inmunidad
  ↓
modificadores y efectos
  ↓
resultado
```

Esto debe construirse de forma general y componible, no mediante excepciones hardcodeadas para cada arma o criatura.

## Hechizos como elementos utilizables, no solamente texto

El libro de hechizos debe aspirar a que un hechizo pueda utilizarse directamente desde la interfaz.

El sistema debería poder conocer, según corresponda:

- alcance;
- área;
- objetivos;
- daño;
- tipo de daño;
- duración;
- concentración;
- recursos consumidos;
- tiradas;
- salvaciones;
- condiciones;
- efectos secundarios;
- reglas especiales.

Cuando la información sea estructurable, el sistema debe poder utilizarla para ayudar durante la partida.

No debe obligar al usuario a pelear constantemente con explicaciones manuales o mediciones que el sistema ya podría resolver.

## Contenido personalizado como ciudadano de primera clase

El contenido casero o personalizado no debe ser tratado como una excepción incómoda.

El sistema debe diseñarse para que puedan existir, entre otras cosas:

- hechizos personalizados;
- armas personalizadas;
- criaturas personalizadas;
- habilidades;
- objetos;
- condiciones;
- recursos;
- efectos;
- clases, subclases o conceptos especiales cuando la arquitectura llegue a cubrirlos.

El contenido personalizado debe integrarse con los mismos sistemas que el contenido conocido.

Por ejemplo, un hechizo creado por el usuario debería poder participar, cuando corresponda, en:

- selección de objetivos;
- medición de alcance;
- áreas;
- tiradas;
- daño;
- resistencias;
- vulnerabilidades;
- condiciones;
- duración;
- recursos;
- iniciativa;
- guardado;
- sincronización multijugador.

No debería requerir soluciones extrañas como convertir un hechizo nuevo en otro hechizo existente solo porque el sistema no entiende conceptos extensibles.

## Personajes fuera de lo convencional

D&D no debe asumir que todos los personajes encajan perfectamente en un conjunto reducido de plantillas.

Si una persona crea un personaje muy particular, el objetivo es que el sistema pueda adaptarse a ese personaje y conservar compatibilidad con el resto de la partida.

Esto implica evitar arquitecturas donde:

- las reglas estén atadas a listas cerradas;
- cada nueva habilidad requiera modificar código central;
- los efectos personalizados sean únicamente texto sin posibilidad de interacción;
- un personaje especial rompa automáticamente combate, medición, efectos o sincronización.

La meta arquitectónica es construir **primitivas de reglas componibles**.

Ejemplos de primitivas posibles:

- daño;
- curación;
- modificar atributo;
- aplicar condición;
- consumir recurso;
- crear recurso;
- tirar dados;
- comparar resultado;
- seleccionar objetivo;
- definir área;
- mover;
- reaccionar a un evento;
- ejecutar un efecto durante cierta duración.

Funciones complejas podrían construirse combinando estas piezas.

## Extensibilidad antes que listas cerradas

Cuando exista una elección entre:

1. implementar una lista cerrada de casos específicos; o
2. crear un modelo general razonablemente simple que permita representar esos casos y otros futuros;

se debe preferir normalmente la segunda opción, siempre que no implique sobrearquitectura prematura.

Esto no significa construir desde ahora un lenguaje de programación completo.

Significa evitar decisiones que hagan extremadamente costoso añadir reglas o contenido nuevo más adelante.

## Diseño orientado a datos

Cuando las mecánicas comiencen a implementarse, se favorecerá una representación basada en datos y efectos componibles.

Ejemplo conceptual:

```text
Weapon
Spell
Creature
Ability
Item
        ↓
propiedades + efectos + condiciones + disparadores
        ↓
motor de reglas
        ↓
resultado en la partida
```

El frontend no debería contener toda la lógica específica de cada hechizo, arma o criatura.

La lógica general debe poder operar sobre datos estructurados.

## Compatibilidad del contenido personalizado

"Personalizado" no debe significar "sin automatización".

Cuando un objeto personalizado utilice conceptos que el motor conoce, debe recibir automáticamente las mismas capacidades que el contenido incorporado.

Por ejemplo:

- un arma personalizada con daño de fuego debe interactuar con resistencia al fuego;
- un hechizo personalizado con radio debe poder mostrar su área;
- una criatura personalizada con inmunidad debe utilizar esa inmunidad en combate;
- una habilidad personalizada con duración debe poder participar en el seguimiento de efectos.

El objetivo es que el sistema comprenda **qué hace** el contenido, no únicamente **cómo se llama**.

## Escape hatch para ideas realmente nuevas

No es realista asumir que un esquema fijo podrá anticipar todas las mecánicas que alguien pueda imaginar.

Por eso, a largo plazo la arquitectura debe dejar espacio para ampliar el vocabulario de reglas sin romper compatibilidad.

Si una idea verdaderamente nueva no puede expresarse con las primitivas existentes, el sistema debería poder evolucionar mediante:

- nuevas primitivas;
- efectos compuestos;
- reglas configurables;
- eventualmente mecanismos seguros de extensión si realmente son necesarios.

La primera respuesta no debe ser obligar al usuario a deformar su idea para encajarla en otra mecánica existente.

## Consecuencias para UX

La flexibilidad no debe trasladar complejidad innecesaria al jugador.

Crear contenido avanzado puede requerir una interfaz más profunda, pero **usar** ese contenido durante una partida debe seguir siendo simple.

Idealmente:

```text
crear/configurar una vez
          ↓
sistema entiende sus propiedades
          ↓
durante la partida:
usar → elegir objetivo → resolver
```

No:

```text
cada vez que se usa
→ explicar manualmente
→ medir manualmente
→ recordar excepciones
→ recalcular
→ corregir al sistema
```

## Consecuencias para arquitectura

Esta visión implica que futuras decisiones importantes deben considerar:

- modelo de reglas extensible;
- efectos y modificadores componibles;
- separación entre definición de contenido y ejecución;
- IDs y referencias estables;
- versionado/migración de contenido;
- validación de contenido personalizado;
- compatibilidad multijugador;
- persistencia;
- representación neutral de contenido oficial y casero;
- capacidad de añadir nuevas propiedades sin romper datos antiguos.

No es necesario implementar todo esto inmediatamente.

Sí es necesario evitar decisiones tempranas que hagan imposible llegar aquí sin reescribir todo el proyecto.

## Consecuencias para integraciones

Las integraciones externas siguen siendo valiosas.

Se pueden importar mapas, personajes, contenido u otros datos cuando sea legal y técnicamente viable.

Pero el núcleo de juego no debe requerir una integración externa para funcionar.

El principio es:

> **integrar cuando mejora la experiencia; depender solo cuando sea inevitable.**

## Consecuencias para el roadmap

Esta visión no cambia la prioridad inmediata de estabilidad y multijugador.

Primero necesitamos una herramienta que permita jugar cómodamente.

Después, las mecánicas pueden crecer por capas:

1. infraestructura estable;
2. multijugador y persistencia;
3. escenas y flujo de sesión;
4. dados, HP, iniciativa y fundamentos;
5. combate estructurado;
6. hechizos, condiciones y recursos;
7. automatización de resistencias, vulnerabilidades y efectos;
8. herramientas de creación de contenido;
9. sistemas avanzados de reglas y extensibilidad.

El orden exacto puede cambiar según pruebas reales.

## No objetivo inmediato

Esta decisión no significa:

- implementar todas las reglas de D&D ahora;
- automatizar cada regla existente antes de tener una mesa estable;
- sustituir inmediatamente libros o manuales;
- construir un lenguaje de scripting completo en las próximas versiones;
- garantizar desde hoy que cualquier concepto imaginable pueda representarse sin ampliar el motor.

Es una **North Star de diseño**.

Cada nueva capa debe acercar el proyecto a ella sin sacrificar estabilidad ni facilidad de uso.

## Criterio para evaluar futuras decisiones

Cuando aparezca una decisión importante, conviene preguntar:

1. ¿Hace más fácil jugar?
2. ¿Funciona bien para alguien nuevo?
3. ¿Sigue siendo eficiente para alguien experimentado?
4. ¿Reduce trabajo repetitivo?
5. ¿Mantiene abierta la posibilidad de contenido personalizado?
6. ¿Está introduciendo una lista cerrada que nos limitará después?
7. ¿Hace al sistema innecesariamente dependiente de otra herramienta?

Si una solución es cómoda hoy pero bloquea seriamente esta visión futura, debe reconsiderarse.

## Principio histórico

> **D&D debe ser una herramienta completa y cómoda para jugar a distancia: sencilla para empezar, potente para quien la necesite y suficientemente extensible para que las ideas de los jugadores no tengan que adaptarse al sistema; el sistema debe poder adaptarse a ellas.**
