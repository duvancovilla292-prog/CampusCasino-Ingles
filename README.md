# ♠ Casino Campus

Simulador educativo de casino y juegos de mesa **multijugador en tiempo real** con fichas virtuales (cero riesgo real). Está hecho con HTML, CSS y JavaScript vanilla, sin frameworks ni build. La sincronización entre dispositivos usa Firebase Realtime Database, así que no necesitas backend propio.

- **Tema:** fieltro verde oscuro y dorado, adaptado a móvil y escritorio.
- **Stack:** HTML5, CSS3, JavaScript ES6+, Canvas 2D, Web Audio API y Firebase Realtime Database (SDK `compat` desde el CDN de Google).
- **Despliegue:** cualquier hosting estático (GitHub Pages, Netlify, Firebase Hosting...).

---

## Tabla de contenidos

1. [Características](#características)
2. [Estructura del proyecto](#estructura-del-proyecto)
3. [Inicio rápido](#inicio-rápido)
4. [Flujo de uso](#flujo-de-uso)
5. [Juegos](#juegos)
6. [Juegos casuales por iframe (Arcade)](#juegos-casuales-por-iframe-arcade)
7. [Herramientas de selección al azar](#herramientas-de-selección-al-azar)
8. [Funciones sociales y de progreso](#funciones-sociales-y-de-progreso)
9. [Panel de administrador y ajustes del Host](#panel-de-administrador-y-ajustes-del-host)
10. [Arquitectura](#arquitectura)
11. [Modelo de datos en Firebase](#modelo-de-datos-en-firebase)
12. [Configuración](#configuración)
13. [Seguridad y reglas de Firebase](#seguridad-y-reglas-de-firebase)
14. [Compatibilidad y accesibilidad](#compatibilidad-y-accesibilidad)
15. [Solución de problemas](#solución-de-problemas)
16. [Cómo extender el proyecto](#cómo-extender-el-proyecto)

---

## Características

- **Salas multijugador** con código de 6 caracteres: un dispositivo crea la sala (Host) y los demás entran con el código o con un enlace `?room=CODIGO`.
- **Conexión automática** a Firebase: la configuración está incrustada en el código, sin pantallas de configuración.
- **Jugadores persistentes por sala:** saldo y estadísticas se guardan en Firebase y se actualizan en vivo en todos los dispositivos.
- **Más de 20 juegos** en tres bloques: casino, juegos casuales y de fiesta, y herramientas de sorteo.
- **Arcade de juegos por iframe** (estilo Poki / CrazyGames) cuya lista administra el Host en tiempo real y se respalda en `data/data.json`.
- **Mesas compartidas** con lobby y asientos (Blackjack, Black Widow Poker, UNO, Parqués, Dominoes y más), con apuestas opcionales y relleno con un bot cuando juegas solo.
- **Capa social y de progreso:** chat y reacciones de sala, jackpot comunitario, tienda de cosméticos, misiones diarias, Lucky Spin diario, títulos y logros, y un Banco Central con préstamos de emergencia.
- **Torneos de eliminación directa** que todos ven en vivo.
- **Panel de administrador** (solo el Host): gestión de jugadores, expulsión, control de partida, edición manual de puntajes, ajustes en vivo, límites de apuesta, banco, registro de auditoría y respaldos.
- **Tabla de clasificación** en vivo.
- **Sonido sintetizado** con Web Audio (sin archivos de audio) y botón de silencio.
- **Efectos de celebración** para grandes premios y notificaciones tipo toast.

---

## Estructura del proyecto

```
index.html
CSS/
  style.css
data/
  data.json          Lista por defecto de juegos del Arcade (reemplázala con la que descargues del panel)
JS/
  firebase-sync.js   (1) Firebase, Room, State, mesas compartidas (Tables), Banco, listeners por sala
  ui-audio.js        (2) DOM, audio, UI, router, tienda, chat, jackpot, misiones, logros, Lucky Spin
  casino-games.js    (3) Juegos de casino tradicionales
  casual-games.js    (4) Juegos casuales y de fiesta, sorteos y torneos
  admin-panel.js     (5) Panel de admin, ajustes del Host, límites, auditoría y arranque
```

Los cinco scripts son **scripts clásicos** (no módulos ES) y se cargan en ese orden con `defer`. Comparten las declaraciones de nivel superior a través del ámbito global, por eso el orden importa: `admin-panel.js` va el último porque necesita a todos los demás y contiene el arranque en `DOMContentLoaded`.

---

## Inicio rápido

1. Sirve la carpeta con cualquier servidor estático (o súbela a GitHub Pages) y abre `index.html`.
2. Necesitas conexión a internet: el SDK de Firebase se carga desde `gstatic.com`.
3. Pulsa **Create Room** para crear una sala, o escribe un código y pulsa **Join Room**.

No hay paso de instalación ni de build. Si abres `index.html` directamente desde el disco, comprueba que las carpetas `CSS/` y `JS/` conserven esos nombres exactos (mayúsculas incluidas).

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
La barra superior muestra sala, jugador, saldo y la navegación entre juegos, además de sonido, clasificación, recompensas, chat, panel de admin (solo Host) y **Leave**.

---

## Juegos

### Casino (con fichas)

| Juego | Notas |
|---|---|
| **Blackjack** | Mesa compartida con lobby y hasta 5 asientos. Hit y Stand; la banca pide hasta llegar a 17; ases valen 11 o 1. Blackjack natural **×2,5**, victoria normal ×2, empate devuelve la apuesta |
| **Baccarat** | Rondas multijugador con temporizador compartido |
| **Poker Dice** | Dados 3D |
| **VIP Keno** | Sorteo de números |
| **Ruleta** (0–36) | Apuesta a número, color o paridad. Número pleno **×36**; color y paridad **×2** (el 0 pierde en paridad) |
| **Tragamonedas** | 3 rodillos con 6 símbolos. Tres iguales **×10**; dos iguales **×2** |
| **Hi-Lo** | Adivina si la siguiente carta es mayor o menor. Acierto ×2; empate devuelve la apuesta |
| **Craps, Crash, Money Wheel** | Juegos de apuesta con fichas; las reglas se explican en su pantalla |
| **Black Widow Poker (La Viuda Negra)** | Mesa compartida de hasta 6 asientos con ante de 10 fichas |
| **Quick Dice** | Ronda de dados sincronizada para toda la sala |

### Casuales y de fiesta (apuesta opcional)

| Juego | Jugadores |
|---|---|
| **UNO** | Hasta 6 |
| **Parqués**, **Dominoes**, **Chinese Checkers** | Hasta 4 |
| **Chess**, **Connect Four**, **Battleship**, **Color Code Breaker**, **Picas y Fijas** | 2 |
| **Hangman** | Multijugador |
| **Arcade Games** | Juegos HTML5 externos embebidos en `<iframe>` (por defecto, Kick The Buddy). Sin fichas; ver la sección siguiente |
| **Marble Gravity Race** | Toda la sala; carrera de canicas por un laberinto con gravedad |

Todas las mesas comparten el mismo flujo:

- Un jugador **abre la mesa**, los demás toman asiento, y el dueño de la mesa pulsa **Start game now**.
- Cada mesa tiene un número mínimo de jugadores (por ejemplo, UNO, Parqués y Dominoes necesitan 2). Si juegas solo, los juegos casuales de 2 jugadores ofrecen al **Casino Bot** como rival.
- Las apuestas de las mesas casuales usan las fichas de apuesta **0, 10, 25, 50, 100 y 250**.
- Si el dueño abandona la mesa, otro jugador sentado puede asumir el control.
- Si un jugador no mueve en su turno, el resto puede pulsar el botón de **expulsar por inactividad** pasado el límite de turno (45 segundos por defecto, configurable por el Host).

Notas generales:
- Las apuestas se validan (número entero, mayor que cero, no superior al saldo y dentro del **límite máximo de apuesta** de la sala).
- Un premio mayor o igual a **250 fichas** dispara la animación de celebración (`BIG_WIN_THRESHOLD`).
- Cada ronda actualiza `gamesPlayed`, `totalWagered` y `netProfit` del jugador.
- Si el saldo baja a 0 no puedes apostar: puedes pedir un préstamo al Banco Central o pedirle al Host que reinicie tu saldo.

---

## Juegos casuales por iframe (Arcade)

Pestaña **Arcade Games** (*Casual Games*). Los jugadores ven una cuadrícula de juegos, abren uno y lo juegan en un contenedor responsive; solo hay un iframe montado a la vez, y se elimina al volver a la lista, cambiar de pestaña o salir de la sala (así no queda sonido en segundo plano). Los juegos no usan fichas ni afectan a las estadísticas.

Cada juego se renderiza con la estructura estándar:

```html
<iframe
  src="https://html5.gamedistribution.com/CODIGO_DEL_JUEGO/"
  width="800"
  height="600"
  scrolling="no"
  frameborder="0"
  allowfullscreen>
</iframe>
```

El contenedor usa `max-width` y `aspect-ratio` calculados con el ancho y alto de cada juego, así que se adapta a móvil y escritorio. (Nota: el valor válido del atributo es `scrolling="no"`, no `"none"`.)

### Gestión (solo Host autenticado)

El botón **⚙ Manage games** y todo el editor se construyen en el DOM **únicamente** si el dispositivo es el Host y ya introdujo el PIN del panel de admin; para los demás jugadores el contenedor queda vacío. Desde el editor puedes:

- **Añadir y editar** juegos: título, icono (emoji), descripción, ancho y alto, y el origen.
- **Ordenar** (▲ ▼), **ocultar/mostrar** y **eliminar** juegos.
- **Descargar `data.json`**, **Importar JSON** y **Reset from repo data.json**.

El campo de origen acepta un **código de GameDistribution** (32 caracteres), una **URL https**, un fragmento `<iframe ...>` pegado o un enlace Markdown `[url](url)`. Por seguridad solo se aceptan URLs `https` de los hosts permitidos en `Arcade.ALLOWED_HOSTS` (`gamedistribution.com`, `crazygames.com` y `poki.com`, incluidos sus subdominios). Para añadir otro proveedor, edita esa lista en `JS/casual-games.js`.

### Persistencia híbrida

| Capa | Dónde | Para qué |
|---|---|---|
| **Tiempo real** | Firebase: `rooms/{code}/arcade` | Cada cambio del Host llega al instante a todos los jugadores de la sala |
| **Repositorio** | `data/data.json` | Lista por defecto: se usa mientras el Host no haya editado la lista en esa sala. Si no se puede leer (por ejemplo, al abrir el HTML con `file://`), se usa una copia integrada |

GitHub Pages es estático y la página no puede escribir en el repositorio, así que el flujo para hacer un cambio permanente es:

1. En el editor, añade o edita los juegos (se ven al instante en la sala).
2. Pulsa **⬇ Download data.json**.
3. Reemplaza `data/data.json` en tu repositorio, haz commit y espera a que GitHub Pages se actualice.

Mientras haya cambios sin descargar, el editor muestra un aviso naranja. Formato del archivo:

```json
{
  "version": 1,
  "updatedAt": "2026-10-13T00:00:00.000Z",
  "games": [
    {
      "id": "kick-the-buddy",
      "title": "Kick The Buddy",
      "icon": "🥊",
      "description": "Relax-and-play ragdoll sandbox.",
      "src": "https://html5.gamedistribution.com/3785ca02d41845c389b09c5e1ff4ced7/",
      "width": 800,
      "height": 600,
      "enabled": true
    }
  ]
}
```

Al importar, los juegos inválidos (título vacío o `src` no permitido) se omiten y se avisa cuántos fueron. El límite es de 60 juegos.

---

## Herramientas de selección al azar

### Lucky Draw: sorteo de 1 a 6 ganadores

Elige cuántos ganadores (1–6) y uno de los cuatro modos; pulsa **Draw Winners**. Los ganadores se eligen con un barajado imparcial (Fisher-Yates) y después la animación se dirige hacia ellos. Si hay menos jugadores que ganadores pedidos, se sortean los que existan y se avisa.

| Modo | Descripción |
|---|---|
| 🎰 **Slot Reels** | N rodillos verticales con nombres giran de forma independiente y frenan uno tras otro con rebote físico |
| 🎱 **Bingo Blower** | Un globo con esferas que rebotan y chocan (física 2D en canvas); un tubo extrae la esfera de cada ganador |
| 🃏 **Card Dealer** | Un mazo se baraja, se reparten N cartas y se voltean automáticamente con resplandor dorado |
| 🔮 **Chip Laser** | Fichas con los nombres caen y giran; un láser fija a cada ganador, que vuela al podio |

Detalles:
- Los ganadores aparecen en un **podio** numerado y se resumen en texto al final.
- El sorteo **solo lee** la lista de jugadores y se ejecuta **localmente** en el dispositivo que lo inicia.
- Durante un sorteo se bloquean los selectores; **Reset** cancela y limpia. Cambiar de pestaña también cancela el sorteo.
- Respeta `prefers-reduced-motion`.

### Player Wheel (Rueda de Jugadores)

Gira una rueda cuyas porciones son los jugadores de la sala. Al caer en uno, decides mantenerlo o quitarlo del grupo. No usa fichas ni escribe en la base de datos.

### Torneos

El Host construye un cuadro de **eliminación directa** y reporta los resultados; el resto de la sala lo sigue en vivo.

---

## Funciones sociales y de progreso

| Función | Descripción |
|---|---|
| **Chat y reacciones** | Chat de sala con contador de mensajes sin leer y reacciones rápidas |
| **Jackpot comunitario** | Bóveda compartida de la sala |
| **Tienda (Shop v2)** | Cosméticos en 5 categorías: avatar, marco, borde, insignia y título. El Host puede añadir artículos propios |
| **Misiones diarias** | Retos por categoría (Casino, Casual, Wins, Bonus) con recompensa en fichas |
| **Lucky Spin** | Giro diario de recompensa |
| **Títulos y logros** | Se desbloquean por rondas jugadas, victorias, rachas y más |
| **Banco Central** | Reserva de fichas y **préstamos de emergencia** solo para jugadores con 0 fichas. El Host aprueba o rechaza (o activa la aprobación automática) y fija préstamo máximo e interés. Por defecto: reserva de 5.000, préstamo máximo de 500 e interés del 10 % |

El panel **Rewards** agrupa Missions, Lucky Spin, Titles y Bank.

---

## Panel de administrador y ajustes del Host

El panel de administrador solo se puede abrir desde el **dispositivo que creó la sala** (se compara un `deviceId` guardado en `localStorage` con `meta.hostDeviceId`). Además pide un **PIN** (`CONFIG.ADMIN_CODE`, por defecto `admin123`). Hasta que el PIN es correcto, los controles avanzados **no se construyen en el DOM**.

### Gestión de jugadores
- Totales: jugadores, fichas en circulación y rondas jugadas.
- **Reset chips:** fija un nuevo saldo a un jugador.
- **Kick:** expulsa a un jugador. Su pantalla vuelve a la pantalla inicial con un aviso, se libera su asiento si la mesa está en lobby, apuesta o terminada, y se borra su perfil. No puedes expulsarte a ti mismo y el jugador puede volver a entrar con el código de sala.
- **Delete:** elimina el perfil de un jugador.
- **Export / Import:** descarga o restaura un respaldo JSON (`casino-campus-backup-<timestamp>.json`).
- **Delete all:** borra todos los jugadores de la sala.
- **Arcade:** tras desbloquear el panel, la pestaña Arcade Games muestra el botón **Manage games** (ver [Juegos casuales por iframe](#juegos-casuales-por-iframe-arcade)).

### Control total de partida
- **⚡ Force start current table:** arranca la mesa del juego que tengas abierto detrás del panel aunque falten jugadores. Debes estar sentado en esa mesa mientras está en lobby; el Host toma la mesa y se salta el mínimo de jugadores solo para ese arranque.
- **Edit scores manually:** elige jugador, acción (**Add**, **Subtract** o **Set to**) y cantidad. Se aplica con una transacción de Firebase, por lo que no pisa pagos que lleguen al mismo tiempo, y el saldo nunca baja de 0. El jugador ve el cambio al instante.

### Ajustes en vivo (Live room settings)
- **Seconds per turn (5–600)**, **Rounds (1–20)** y **Difficulty (Easy, Normal, Hard)**.
- Se guardan en `rooms/{code}/adm/cfg` y todos los clientes los reciben al instante, con un aviso a los jugadores.
- El tiempo por turno se aplica al límite de turno de Blackjack, Black Widow Poker, UNO, Parqués, Dominoes y Hangman.
- **Rounds** y **Difficulty** se comparten con toda la sala, pero los juegos actuales todavía no los consumen. Se leen con `RoomCfg.get("rounds")` y `RoomCfg.get("difficulty")`.

### Host Settings (ajustes del Host)
Un centro de control con pestañas:

| Pestaña | Función |
|---|---|
| **Room** | Gestión de la sala y opciones del **ganador elegido (Rig)** para sorteos y juegos que lo consultan; cada uso queda en el registro de auditoría |
| **Shop** | Alta y gestión de artículos de la tienda |
| **Missions** | Gestión de misiones y reinicio de su progreso |
| **Limits** | **Límite máximo de apuesta**, global y por juego (por defecto 50.000) |
| **Bank** | Reserva, préstamo máximo, interés, aprobación automática y solicitudes pendientes |
| **Audit** | Registro de eventos de la sala con filtro por tipo (grandes premios, rig, misiones, préstamos, giros, límites, torneos, banco, logros, kick, force, score y config) |

---

## Arquitectura

El código está organizado en módulos (objetos literales) repartidos en cinco archivos. Resumen:

| Archivo | Módulos principales | Responsabilidad |
|---|---|---|
| `firebase-sync.js` | `CONFIG`, `Room`, `PubSub`, `ConnectionStatus`, `State`, `Tables`, `Bank`, `Force`, `RoomCfg`, `Kick`, `Z` | Constantes y Firebase, capa de red (crear/unirse a sala, listeners, CRUD de jugadores, puntajes), sesión activa, lobbies de mesa compartidos, banco y listeners por sala |
| `ui-audio.js` | `DOM`, `Sound`, `Effects`, `Notify`, `HUD`, `Validate`, `Router`, `AuthScreen`, `Leaderboard`, `Shop`, `Chat`, `Jackpot`, `Social`, `Missions`, `Rewards` | Caché del DOM, audio, celebraciones, toasts, navegación SPA, pantallas de sala y jugadores, tienda, chat, misiones, logros y Lucky Spin |
| `casino-games.js` | `CardFX`, `Deck`, `GameResolver`, `Blackjack`, `Baccarat`, `Roulette`, `Slots`, `HiLo`, `BW`, `Dice`, `Keno`, `PokerDice` y más | Motor de cartas y juegos de casino |
| `casual-games.js` | `PlayerWheel`, `LuckyDraw`, UNO, mesas casuales, `MarbleRace`, `Tour`, `Arcade` | Juegos casuales, sorteos, torneos y el Arcade de juegos por iframe |
| `admin-panel.js` | `Admin`, `AdminCtl`, `Plus`, `Rig`, `BetLimits`, `Audit`, `ZAdmin` | Panel de admin, ajustes del Host, límites, auditoría y arranque |

Principios de diseño:
- **Firebase es la única fuente de verdad.** Los saldos nunca se guardan en local; `players-updated` sincroniza el saldo propio en vivo (por ejemplo, tras un cambio del admin).
- **Pagos atómicos:** los pagos y ajustes usan transacciones con deltas, de modo que un premio, un reparto de jackpot o una edición del admin no se pisan entre sí.
- **Sin dependencias externas** aparte del SDK de Firebase; el audio es sintetizado.
- **Manipulación segura del DOM:** los textos de usuario se insertan con `textContent` o escapados, no con HTML crudo.
- **Vistas:** `view-setup` → `view-auth` → `view-lobby`, controladas con el atributo `hidden`.

---

## Modelo de datos en Firebase

```
rooms/
  {ROOM_CODE}/
    meta/        hostDeviceId, createdAt, roomCode
    players/
      {username}/  username, balance, createdAt, updatedAt, deviceId,
                   stats/ { gamesPlayed, totalWagered, netProfit },
                   loan/  { p, owed, rate, ts }        (solo con préstamo activo)
    bj, bw, bwstats, baccarat, uno, parques, dominoes, hangman,
    chess, checkers, mastermind, bullscows, connect4, battleship
                 mesas: phase, owner, seats, max, turnAt, ... (estado de la partida)
    marble/current   configuración de la carrera de canicas
    tour             torneo en curso
    dice, rounds     rondas sincronizadas y reclamos de pago
    jackpot, shop, chat, reactions
    cfg              configuración de misiones, tienda y ganador elegido
    lim              límites de apuesta { g, games }
    bank/            cfg, res (reserva), req/{username} (solicitudes)
    audit            registro de eventos
    adm/cfg          ajustes en vivo { turnSec, rounds, difficulty, ts }
    arcade           lista de juegos del Arcade { custom, games/{id}/{title, icon, description, src, width, height, enabled, order}, ts, by }
    kicks/{username} señal de expulsión { ts, by }
```

- El código de sala usa el alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sin caracteres ambiguos 0/O/1/I) y se verifica que esté libre antes de crear la sala.
- Los saldos se redondean y nunca bajan de 0.
- Las señales de `kicks/` solo se respetan si son recientes (menos de 20 segundos); las antiguas se ignoran.

---

## Configuración

### Firebase
La configuración está incrustada en `CONFIG.FIREBASE_CONFIG` (en `JS/firebase-sync.js`):

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

### Otras constantes

| Constante | Valor por defecto | Descripción |
|---|---|---|
| `CONFIG.ADMIN_CODE` | `"admin123"` | PIN del panel de administrador. **Cámbialo antes de publicar** |
| `CONFIG.LEADERBOARD_LIMIT` | `15` | Jugadores mostrados en la clasificación |
| `CONFIG.BIG_WIN_THRESHOLD` | `250` | Premio mínimo para la animación de celebración |
| `BetLimits.DEF` | `50000` | Límite máximo de apuesta por defecto (editable por sala desde el panel) |
| `RoomCfg.DEF` | `45 s`, `3`, `normal` | Tiempo por turno, rondas y dificultad por defecto |

---

## Seguridad y reglas de Firebase

La configuración web de Firebase es pública por naturaleza; lo que protege tus datos son las **reglas de la base de datos**. Ten en cuenta:

- En **modo de prueba**, cualquiera puede leer y escribir todas las salas.
- El PIN de admin está en el código fuente y la comprobación de Host se hace en el cliente. Los controles del panel (expulsar, forzar inicio, editar puntajes, ajustes en vivo) solo están ocultos por la interfaz: sirve para un entorno educativo, **no** como seguridad real. Alguien con conocimientos podría escribir esos nodos (`kicks/`, `adm/cfg`, `players/`) directamente.
- Las URLs de los iframes se validan en el cliente (https y hosts permitidos), pero el nodo `arcade/` también debería protegerse con reglas para que solo el Host pueda escribirlo.
- Para más protección, añade **Firebase Authentication** y restringe las reglas: por ejemplo, que solo el Host pueda escribir en `kicks/`, `adm/` y `lim/`, y que `players/{username}/balance` se valide por tipo y rango.
- Considera restringir la clave de API por dominio desde la consola de Google Cloud.
- No se procesa dinero real: todas las fichas son virtuales.

---

## Compatibilidad y accesibilidad

- Navegadores modernos con soporte de ES6+, Canvas 2D, Web Audio y CSS `dvh` / `aspect-ratio` (Chrome, Edge, Firefox y Safari recientes).
- Diseño responsivo con áreas seguras (`env(safe-area-inset-*)`) para móviles con notch.
- Roles y regiones `aria` (`role="alert"`, `aria-live`, `aria-pressed`) en formularios, notificaciones, botones de selección y resultados.
- `prefers-reduced-motion` reduce las animaciones.

---

## Solución de problemas

| Problema | Posible causa y solución |
|---|---|
| "Could not reach Firebase" | Sin conexión o el SDK no cargó (bloqueador de anuncios, red restringida). Revisa la conexión y recarga |
| "Room not found" | Código incorrecto o sala inexistente. Confirma el código con el Host |
| Permiso denegado en la consola | Las reglas de Realtime Database bloquean la operación. Revisa las reglas |
| Un juego del Arcade no carga | El proveedor puede bloquear tu dominio o el iframe. Prueba con otro juego o revisa la configuración del dominio en tu cuenta de GameDistribution |
| "Invalid source" al añadir un juego | Usa un código de GameDistribution, una URL https o un `<iframe>` de un host permitido (`Arcade.ALLOWED_HOSTS`) |
| No veo el botón Manage games | Solo aparece en el dispositivo Host y después de introducir el PIN en el panel de admin |
| La página carga sin estilos o sin scripts | Las rutas `CSS/style.css` y `JS/*.js` deben existir con esos nombres exactos |
| No se ve el panel de admin | Solo aparece en el dispositivo Host; si borraste el almacenamiento local perdiste esa identidad |
| "Force start" no hace nada | Debes estar sentado en la mesa abierta del juego que tienes en pantalla, mientras está en lobby |
| Una mesa no arranca | Revisa el número mínimo de jugadores y que todos cubran la apuesta de la mesa |
| No hay sonido | Revisa el botón de silencio; los navegadores exigen una interacción previa del usuario |
| Lucky Draw dice "No players" | La sala aún no tiene jugadores creados |

---

## Cómo extender el proyecto

- **Nuevo juego de casino:** añade una `<section class="game-section" data-game-section="...">`, un elemento de menú con `data-game` y un módulo con `init()` en `JS/casino-games.js`. Usa `State.debit/credit` y `GameResolver` para saldos y estadísticas.
- **Nuevo juego de mesa:** reutiliza `Tables` (apertura, asientos, lobby con `Tables.renderLobby`) y, para turnos, lee el límite con `RoomCfg.turnMs(45000)` para respetar el ajuste del Host.
- **Leer los ajustes en vivo:** `RoomCfg.get("rounds")`, `RoomCfg.get("difficulty")` y el evento `PubSub.on("roomcfg-updated", fn)`.
- **Nuevo modo de sorteo:** agrega un botón `.draw-mode-btn` con `data-draw-mode` y un método `runXxx(names, winners, id)` en `LuckyDraw`. Usa `this.frames(id, fn)` y `this.wait(ms, id)` para que sea cancelable, y `this.announce(name, rank)` para poblar el podio.
- **Nuevo proveedor de juegos por iframe:** añade su dominio a `Arcade.ALLOWED_HOSTS` en `JS/casual-games.js`.
- **Nuevos controles de admin:** añádelos dentro de `AdminCtl.build()` en `JS/admin-panel.js`; así solo existen en el DOM cuando el Host ha desbloqueado el panel.
- **Estilos:** los colores y radios están en variables CSS (`:root`); cambiar el tema es editar esas variables.

---

## Aviso

Proyecto con fines **educativos y de entretenimiento**. Las fichas no tienen valor monetario y la aplicación no promueve el juego con dinero real.
