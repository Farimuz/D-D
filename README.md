# D&D

Proyecto para crear una herramienta propia que facilite organizar y jugar partidas de Dungeons & Dragons a distancia.

La idea es construir una experiencia sencilla de usar tanto en PC como en teléfono, especialmente pensada para reducir el trabajo del Dungeon Master.

**v0.0.1 es una mesa local experimental:** cuadrícula, fichas con nombre, movimiento con mouse o pantalla táctil, ajuste a casillas y controles de cámara. No hay backend, cuentas ni multijugador.

## Ejecutar

Requiere Node.js 22.18 o posterior y npm. Desde la raíz del repositorio:

```sh
npm install
npm run dev
```

Abre la dirección que muestra Vite. Para probar en un teléfono en la misma red, usa la dirección `Network` del PC; el firewall debe permitir el puerto de desarrollo.

Crea fichas con **＋ Ficha**, arrástralas para moverlas y arrastra el fondo para desplazar la vista. Los botones **− / ＋** ajustan el zoom y **⌖** centra la ficha seleccionada o vuelve al origen. Eliminar y limpiar requieren confirmación.

Fichas, posiciones, cámara y zoom se guardan en `localStorage`, por navegador y dirección. No se comparten entre dispositivos. Si no se puede guardar, la aplicación muestra un aviso.

## Producción

```sh
npm run build
npm run preview
```

El build genera archivos estáticos en `dist/`.

## Pruebas

```sh
npx playwright install chromium firefox webkit
npm test
```

Las pruebas requieren Chrome y Edge instalados en Windows y verifican también Firefox, WebKit y vistas móviles. Incluyen gestos táctiles emulados en Android; la emulación no reemplaza una prueba física en Android o Safari/iOS.
