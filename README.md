# ♠ Casino Campus

Simulador educativo de casino **multijugador en tiempo real** con fichas virtuales (cero riesgo real). Todo vive en **un solo archivo HTML** (`casino-campus.html`) con CSS y JavaScript vanilla, sin frameworks ni librerías externas. La sincronización entre dispositivos usa Firebase Realtime Database, así que no necesitas backend propio.

- **Tema:** fieltro verde oscuro y dorado, adaptado a móvil y escritorio.
- **Stack:** HTML5, CSS3, JavaScript ES6+, Canvas 2D, Web Audio API y Firebase Realtime Database (SDK `compat` 10.13.0 desde CDN de Google).
- **Despliegue:** cualquier hosting estático (GitHub Pages, Netlify, Firebase Hosting...) o abriendo el archivo directamente.

---

## Tabla de contenidos

1. [Características](#características)
2. [Inicio rápido](#inicio-rápido)
3. [Flujo de uso](#flujo-de-uso)
4. [Juegos y reglas](#juegos-y-reglas)
5. [Lucky Draw: sorteo de 1 a 6 ganadores](#lucky-draw-sorteo-de-1-a-6-ganadores)
6. [Panel de administrador](#panel-de-administrador)
7. [Arquitectura](#arquitectura)
8. [Modelo de datos en Firebase](#modelo-de-datos-en-firebase)
9. [Configuración](#configuración)
10. [Seguridad y reglas de Firebase](#seguridad-y-reglas-de-firebase)
11. [Compatibilidad y accesibilidad](#compatibilidad-y-accesibilidad)
12. [Solución de problemas](#solución-de-problemas)
13. [Cómo extender el proyecto](#cómo-extender-el-proyecto)

---

## Características

- **Salas multijugador** con código de 6 caracteres: un dispositivo crea la sala (Host) y los demás entran con el código o con un enlace.
- **Conexión automática** a Firebase: la configuración está incrustada en el script, sin pantallas de configuración.
- **Jugadores persistentes por sala:** saldo y estadísticas se guardan en Firebase y se actualizan en vivo en todos los dispositivos.
- **5 juegos:** Blackjack, Ruleta, Rueda de Jugadores, Tragamonedas y Hi-Lo.
- **Lucky Draw:** sección con 4 modos visuales para elegir de 1 a 6 ganadores entre los jugadores de la sala.
- **Tabla de clasificación** en vivo.
- **Panel de administrador** (solo el Host): reiniciar fichas, eliminar jugadores, exportar/importar respaldos.
- **Sonido sintetizado** con Web Audio (sin archivos de audio) y botón de silencio.
- **Efectos de celebración** para grandes premios y notificaciones tipo toast.

---

## Inicio rápido

1. Abre `casino-campus.html` en un navegador moderno (o súbelo a un hosting estático).
2. Necesitas conexión a internet: el SDK de Firebase se carga desde `gstatic.com`.
3. Pulsa **Create Room** para crear una sala, o escribe un código y pulsa **Join Room**.

No hay paso de instalación ni de build.

---

## Flujo de uso

### Como Host
1. En la pantalla inicial pulsa **Create Room**.
2. Se muestra el **código de sala** y un **enlace para compartir** (`?room=CODIGO`). Puedes copiarlo con **Copy Link**.
3. Pulsa **Continue to Lobby** para ir a la selección de jugador.

### Como invitado
1. Escribe el código de sala (o abre el enlace compartido, que lo rellena solo).
2. Pulsa **Join Room**. Si el código no existe, verás un mensaje de error.

### Selección de jugador
- Elige un jugador ya existente de la lista (con buscador) o crea uno nuevo.
- Nombre de usuario: **3 a 16 caracteres**, solo letras, números, `_` y `-`. No se permiten nombres repetidos en la misma sala.
- Fichas iniciales a elegir: **500, 1.000 (por defecto), 2.500 o 5.000**.

### Lobby
La barra superior muestra sala, jugador, saldo y la navegación entre juegos, además de sonido, clasificación, panel de admin (solo Host) y **Leave**.

---

## Juegos y reglas

| Juego | Reglas resumidas | Pagos |
|---|---|---|
| **Blackjack** | Aciertas más cerca de 21 que la banca sin pasarte. Opciones: Hit y Stand. La banca pide carta hasta llegar a 17. Los ases valen 11 o 1. | Blackjack natural **×2,5**; victoria normal ×2; empate devuelve la apuesta |
| **Ruleta** (0–36) | Apuesta a un número, a color (rojo/negro) o a paridad (par/impar). Fichas de valor seleccionable. | Número pleno **×36**; color **×2**; paridad **×2** (el 0 pierde en paridad) |
| **Rueda de Jugadores** | Gira una rueda cuyas porciones son los jugadores de la sala. Al caer en uno, decides mantenerlo o quitarlo del grupo. No usa fichas ni toca la base de datos. | — |
| **Tragamonedas** | 3 rodillos con 6 símbolos (🍒 🍋 🔔 ⭐ 7️⃣ 🍇). Se tira de la palanca. | Tres iguales **×10** (jackpot); dos iguales **×2** |
| **Hi-Lo** | Se muestra una carta y adivinas si la siguiente será mayor o menor. | Acierto **×2**; empate devuelve la apuesta |

Notas generales:
- Las apuestas se validan (número entero, mayor que cero y no superior al saldo).
- Un premio mayor o igual a **250 fichas** dispara la animación de celebración (`BIG_WIN_THRESHOLD`).
- Cada ronda actualiza `gamesPlayed`, `totalWagered` y `netProfit` del jugador.
- Si el saldo baja a 0 no puedes apostar; el Host puede reiniciarlo desde el panel de admin.

---

## Lucky Draw: sorteo de 1 a 6 ganadores

Pestaña **🎁 Lucky Draw** en el lobby. Elige cuántos ganadores (1–6) y uno de los cuatro modos; pulsa **Draw Winners**. Los ganadores se eligen primero con un barajado imparcial (Fisher-Yates) y después la animación se dirige hacia ellos. Si hay menos jugadores que ganadores pedidos, se sortean los que existan y se avisa.

| Modo | Descripción |
|---|---|
| 🎰 **Slot Reels** | N rodillos verticales con nombres giran de forma independiente y frenan uno tras otro con rebote físico (resorte amortiguado). |
| 🎱 **Bingo Blower** | Un globo circular con esferas que rebotan y chocan (física 2D en canvas). Para cada ganador, el soplador acelera y un tubo extrae la esfera correspondiente. |
| 🃏 **Card Dealer** | Un mazo boca abajo se baraja, se reparten N cartas a la mesa y se voltean automáticamente con resplandor dorado. |
| 🔮 **Chip Laser** | Fichas con los nombres caen y giran en el centro; un láser pulsa sobre candidatos hasta fijar cada ganador, que vuela al podio. |

Detalles:
- Los ganadores aparecen en un **podio** inferior numerado y se resumen en texto al final.
- El sorteo **solo lee** la lista de jugadores; no escribe nada en Firebase.
- El sorteo se ejecuta **localmente** en el dispositivo que lo inicia (no se transmite al resto de la sala).
- Durante un sorteo se bloquean los selectores; **Reset** cancela y limpia. Cambiar de pestaña también cancela el sorteo.
- Respeta `prefers-reduced-motion`.

---

## Panel de administrador

Solo se puede abrir desde el **dispositivo que creó la sala** (se compara un `deviceId` guardado en `localStorage` con `meta.hostDeviceId`). Además pide un **PIN** (`CONFIG.ADMIN_CODE`, por defecto `admin123`).

Funciones:
- Ver totales: jugadores, fichas en circulación y rondas jugadas.
- **Reset chips:** fija un nuevo saldo a un jugador.
- **Delete:** elimina un jugador (si estaba activo en algún dispositivo, se le saca de la sesión).
- **Export:** descarga un respaldo JSON (`casino-campus-backup-<timestamp>.json`).
- **Import:** restaura jugadores desde un JSON exportado.
- **Delete all:** borra todos los jugadores de la sala.

---

## Arquitectura

Todo el JavaScript está dentro de una IIFE con `"use strict"`, organizado en módulos (objetos literales):

| Sección | Módulo | Responsabilidad |
|---|---|---|
| 0 | `CONFIG` | Constantes: claves de almacenamiento, PIN, límites y configuración de Firebase |
| 1 | `Storage` | `deviceId` y ajustes locales (sonido). Nunca guarda saldos |
| 2 | `LinkUtils` | Lectura y construcción de enlaces `?room=` |
| 3 | `Room` | Capa de red: conexión, crear/unirse a sala, listeners, CRUD de jugadores |
| — | `PubSub`, `ConnectionStatus` | Bus de eventos y indicador de conexión |
| 4 | `State` | Sesión activa (jugador, saldo, sala, es Host) |
| 5 | `DOM` | Caché de referencias al DOM |
| 6–9 | `Sound`, `Effects`, `Notify`, `HUD` | Audio, celebración, toasts y barra superior |
| 10 | `Validate` | Sanitización de nombres y validación de apuestas |
| 11 | `Router` | Navegación entre vistas y juegos (SPA) |
| 12–16 | `Deck`, `Blackjack`, `Roulette`, `PlayerWheel`, `Slots`, `HiLo` | Lógica y UI de cada juego |
| 16b | `LuckyDraw` | Sorteo multi-ganador con 4 modos |
| 17–20 | `SetupScreen`, `AuthScreen`, `Leaderboard`, `Admin` | Pantallas de sala, jugadores, ranking y administración |
| 21–22 | `handleLogout`, `init` | Cierre de sesión y arranque en `DOMContentLoaded` |

Principios de diseño:
- **Firebase es la única fuente de verdad.** Los saldos nunca se guardan en local; `players-updated` sincroniza el saldo propio en vivo (por ejemplo, tras un cambio del admin).
- **Sin dependencias externas** aparte del SDK de Firebase; el audio es sintetizado.
- **Manipulación segura del DOM:** los textos se insertan con `textContent`, no con HTML crudo.
- **Vistas:** `view-setup` → `view-auth` → `view-lobby`, controladas con el atributo `hidden`.

---

## Modelo de datos en Firebase

```
rooms/
  {ROOM_CODE}/
    meta/
      hostDeviceId: "dev-..."
      createdAt:    <timestamp del servidor>
      roomCode:     "AB12CD"
    players/
      {username}/
        username:  "Ana"
        balance:   1000
        updatedAt: 1730000000000
        stats/
          gamesPlayed:  0
          totalWagered: 0
          netProfit:    0
```

- El código de sala usa el alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sin caracteres ambiguos 0/O/1/I) y se verifica que esté libre antes de crear la sala.
- Los saldos se redondean y nunca bajan de 0.

---

## Configuración

### Firebase
La configuración está incrustada en `CONFIG.FIREBASE_CONFIG`:

```js
FIREBASE_CONFIG: Object.freeze({
  apiKey: "...",
  authDomain: "...",
  databaseURL: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
})
```

Para usar tu propio proyecto: crea un proyecto en la consola de Firebase, activa **Realtime Database**, registra una app web y reemplaza el objeto con tu `firebaseConfig`.

### Otras constantes (`CONFIG`)

| Constante | Valor por defecto | Descripción |
|---|---|---|
| `ADMIN_CODE` | `"admin123"` | PIN del panel de administrador. **Cámbialo antes de publicar** |
| `LEADERBOARD_LIMIT` | `15` | Jugadores mostrados en la clasificación |
| `BIG_WIN_THRESHOLD` | `250` | Premio mínimo para la animación de celebración |

---

## Seguridad y reglas de Firebase

La configuración web de Firebase es pública por naturaleza; lo que protege tus datos son las **reglas de la base de datos**. Ten en cuenta:

- En **modo de prueba**, cualquiera puede leer y escribir todas las salas.
- El PIN de admin está en el código fuente y la comprobación de Host se hace en el cliente: sirve para un entorno educativo, **no** como seguridad real.
- Para más protección, restringe las reglas (por ejemplo, limitando escritura a `rooms/{code}` y validando tipos y rangos de `balance`) y añade Firebase Authentication si lo necesitas.
- Considera restringir la clave de API por dominio desde la consola de Google Cloud.
- No se procesa dinero real: todas las fichas son virtuales.

---

## Compatibilidad y accesibilidad

- Navegadores modernos con soporte de ES6+, Canvas 2D, Web Audio y CSS `dvh` / `aspect-ratio` (Chrome, Edge, Firefox y Safari recientes).
- Diseño responsivo con áreas seguras (`env(safe-area-inset-*)`) para móviles con notch, y ajustes para pantallas de hasta 480 px.
- Roles y regiones `aria` (`role="alert"`, `aria-live`, `aria-pressed`) en formularios, notificaciones, botones de selección y resultados.
- `prefers-reduced-motion` reduce las animaciones del sorteo.

---

## Solución de problemas

| Problema | Posible causa y solución |
|---|---|
| "Could not reach Firebase" | Sin conexión o el SDK no cargó (bloqueador de anuncios, red restringida). Revisa la conexión y recarga |
| "Room not found" | Código incorrecto o sala inexistente. Confirma el código con el Host |
| Permiso denegado en la consola | Las reglas de Realtime Database bloquean la operación. Revisa las reglas |
| No se ve el panel de admin | Solo aparece en el dispositivo Host; si borraste el almacenamiento local perdiste esa identidad |
| No hay sonido | Revisa el botón de silencio; los navegadores exigen una interacción previa del usuario |
| Lucky Draw dice "No players" | La sala aún no tiene jugadores creados |

---

## Cómo extender el proyecto

- **Nuevo juego:** añade una `<section class="game-section" data-game-section="...">`, un botón en `#game-selector` con `data-game`, y un módulo con `init()` registrado en `init()` al final del script. Usa `State.debit/credit` y `State.recordRound` para saldos y estadísticas.
- **Nuevo modo de sorteo:** agrega un botón `.draw-mode-btn` con `data-draw-mode` y un método `runXxx(names, winners, id)` en `LuckyDraw`, registrado en el mapa de `start()`. Usa `this.frames(id, fn)` y `this.wait(ms, id)` para que el modo sea cancelable, y `this.announce(name, rank)` para poblar el podio.
- **Sorteo sincronizado:** guarda el resultado en `rooms/{code}/draw` desde el dispositivo que sortea y escucha ese nodo en el resto para reproducir la animación.
- **Estilos:** los colores y radios están en variables CSS (`:root`); cambiar el tema es editar esas variables.

---

## Aviso

Proyecto con fines **educativos y de entretenimiento**. Las fichas no tienen valor monetario y la aplicación no promueve el juego con dinero real.
