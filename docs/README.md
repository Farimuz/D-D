# Documentación del proyecto

Este repositorio no existe únicamente para almacenar el código de D&D.

También funciona como la **memoria canónica del proyecto**: aquí deben quedar registradas las decisiones, ideas, criterios de diseño, arquitectura, estructura, límites conocidos y cambios de dirección que expliquen por qué el proyecto termina siendo como es.

El objetivo es que una conversación, una prueba manual o una decisión importante no se pierdan cuando pase el tiempo o cambie la persona/herramienta que trabaje sobre el código.

## Qué debe quedar documentado

Cuando sea relevante, el repositorio debe conservar:

- decisiones de producto y sus consecuencias;
- decisiones de arquitectura;
- ideas que todavía no están comprometidas;
- criterios de UX y diseño;
- estructura actual del sistema;
- prioridades y cambios de roadmap;
- problemas conocidos y deuda aceptada;
- conclusiones obtenidas durante pruebas manuales;
- razones por las que una función se implementó, se pospuso o se descartó.

No hace falta documentar cada conversación ni cada detalle menor. La intención es conservar el contexto que podría cambiar cómo se desarrolla el proyecto en el futuro.

## Organización propuesta

La documentación puede crecer con esta estructura:

```text
docs/
├── README.md
├── decisions/
│   └── ... registros de decisiones aceptadas
├── ideas/
│   └── ... ideas todavía no comprometidas
├── architecture/
│   └── ... arquitectura y estructura vigente
└── design/
    └── ... decisiones de interacción y experiencia de uso
```

No es necesario crear carpetas o documentos vacíos. Se añaden cuando exista contenido real que conservar.

## Registros de decisiones

Las decisiones importantes deben poder responder, de forma breve:

1. ¿Qué problema o contexto existía?
2. ¿Qué se decidió?
3. ¿Por qué?
4. ¿Qué consecuencias tiene?
5. ¿Qué queda explícitamente fuera o aplazado?
6. ¿Qué podría hacer que revisemos la decisión?

Estas decisiones forman historial. Si una decisión cambia en el futuro, es preferible registrar una nueva decisión que explique el cambio en lugar de borrar el razonamiento anterior.

## Estado actual

La primera decisión formal registrada bajo este esquema es:

- [0001 — Priorizar juego e integración con mapas externos sobre generación propia](decisions/0001-external-maps-over-built-in-generation.md)
