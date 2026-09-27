/* =========================================================================
   ONE LAST PIECE
   Tetris simplificado y corto: al colocar cada pieza se revela una foto
   oculta debajo del tablero. No hay clear de líneas: el tablero se arma
   como un mosaico y el objetivo es completarlo entero.
   ========================================================================= */

(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // Configuración del tablero
  // ---------------------------------------------------------------------
  const COLS = 10;
  const PHOTO_ROWS = 16;              // filas que forman la foto (la "meta")
  const BUFFER_ROWS = 5;              // filas libres arriba para mover/girar
  const TOTAL_ROWS = PHOTO_ROWS + BUFFER_ROWS; // alto real del tablero jugable
  const TOTAL_CELLS = COLS * PHOTO_ROWS;
  const IMAGE_PATH = "assets/foto.jpg";

  // Velocidad de caída (ms por fila). Se mantiene constante y generosa
  // para priorizar que la partida se pueda armar sin apuro.
  const BASE_FALL_MS = 1100;
  const LOCK_DELAY_MS = 700; // margen antes de que la pieza quede fija

  // ---------------------------------------------------------------------
  // Definición de piezas (formas por rotación, coordenadas [col, fila]
  // normalizadas a partir de 0)
  // ---------------------------------------------------------------------
  const TYPES = ["I", "O", "T", "L", "J", "S", "Z"];

  const SHAPES = {
    I: [
      [[0, 1], [1, 1], [2, 1], [3, 1]],
      [[2, 0], [2, 1], [2, 2], [2, 3]],
    ],
    O: [
      [[0, 0], [1, 0], [0, 1], [1, 1]],
    ],
    T: [
      [[1, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [2, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [1, 2]],
      [[1, 0], [0, 1], [1, 1], [1, 2]],
    ],
    L: [
      [[2, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [1, 2], [2, 2]],
      [[0, 1], [1, 1], [2, 1], [0, 2]],
      [[0, 0], [1, 0], [1, 1], [1, 2]],
    ],
    J: [
      [[0, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [2, 2]],
      [[1, 0], [1, 1], [1, 2], [0, 2]],
    ],
    S: [
      [[1, 0], [2, 0], [0, 1], [1, 1]],
      [[1, 0], [1, 1], [2, 1], [2, 2]],
    ],
    Z: [
      [[0, 0], [1, 0], [1, 1], [2, 1]],
      [[2, 0], [1, 1], [2, 1], [1, 2]],
    ],
  };

  const COLORS = {
    I: "#6fb7e0",
    O: "#e0c46f",
    T: "#b98fe0",
    L: "#e0a06f",
    J: "#6f8fe0",
    S: "#7fcf9e",
    Z: "#e07f8f",
  };

  // Algunas rotaciones de arriba no arrancan en columna/fila 0 (por
  // ejemplo la I vertical usa columna 2). Se normalizan acá para que
  // todo el resto del código (solver, spawn, colisiones) pueda asumir
  // siempre un bounding box que arranca en [0,0].
  for (const type of TYPES) {
    SHAPES[type] = SHAPES[type].map((cells) => {
      const minCol = Math.min(...cells.map((c) => c[0]));
      const minRow = Math.min(...cells.map((c) => c[1]));
      return cells.map(([c, r]) => [c - minCol, r - minRow]);
    });
  }

  function shapeWidth(type, rotation) {
    const cells = SHAPES[type][rotation];
    return Math.max(...cells.map((c) => c[0])) + 1;
  }

  // ---------------------------------------------------------------------
  // Generador de la secuencia de piezas.
  //
  // Para garantizar que el tablero SIEMPRE tenga al menos una forma de
  // completarse con la secuencia entregada, se simula un llenado "a ras"
  // (sin huecos) trabajando solo con la altura de cada columna. Se arma
  // con backtracking real (no un simple intento al azar) para no
  // quedar trabado en terrenos irregulares.
  //
  // El jugador igual tiene que acertar la ubicación real durante la
  // partida: si arma mal una pieza puede dejar un hueco y perder antes
  // de completar el tablero.
  // ---------------------------------------------------------------------
  const SHAPE_DESCRIPTORS = (() => {
    const list = [];
    for (const type of TYPES) {
      const rotations = SHAPES[type];
      for (let r = 0; r < rotations.length; r++) {
        const cells = rotations[r];
        const colMap = {};
        let maxCol = 0;
        for (const [c, rr] of cells) {
          maxCol = Math.max(maxCol, c);
          if (!colMap[c]) colMap[c] = { bottom: rr, count: 1 };
          else {
            colMap[c].bottom = Math.max(colMap[c].bottom, rr);
            colMap[c].count++;
          }
        }
        list.push({ type, rotation: r, width: maxCol + 1, colMap });
      }
    }
    return list;
  })();

  function shuffledCandidatesFor(heights) {
    const minH = Math.min(...heights);
    const out = [];
    for (const desc of SHAPE_DESCRIPTORS) {
      for (let startCol = 0; startCol <= COLS - desc.width; startCol++) {
        let touchesMin = false;
        for (let j = 0; j < desc.width; j++) {
          if (heights[startCol + j] === minH) touchesMin = true;
        }
        if (!touchesMin) continue;

        let originRow = null;
        let valid = true;
        for (let j = 0; j < desc.width; j++) {
          const cm = desc.colMap[j];
          const globalCol = startCol + j;
          const required = (PHOTO_ROWS - 1 - heights[globalCol]) - cm.bottom;
          if (originRow === null) originRow = required;
          else if (originRow !== required) { valid = false; break; }
        }
        if (!valid || originRow < 0) continue;

        let fits = true;
        for (let j = 0; j < desc.width; j++) {
          if (heights[startCol + j] + desc.colMap[j].count > PHOTO_ROWS) { fits = false; break; }
        }
        if (!fits) continue;

        out.push({
          type: desc.type,
          rotation: desc.rotation,
          startCol,
          width: desc.width,
          colMap: desc.colMap,
        });
      }
    }
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function attemptSolveBacktrack(nodeLimit) {
    let heights = new Array(COLS).fill(0);
    let queue = [];
    const stack = [{
      heights: heights.slice(),
      candidates: shuffledCandidatesFor(heights),
      idx: 0,
      filled: 0,
      queueLen: 0,
    }];
    let nodes = 0;

    while (stack.length) {
      nodes++;
      if (nodes > nodeLimit) return null;

      const top = stack[stack.length - 1];
      if (top.idx >= top.candidates.length) {
        stack.pop();
        continue;
      }
      const choice = top.candidates[top.idx++];
      const newHeights = top.heights.slice();
      let added = 0;
      for (let j = 0; j < choice.width; j++) {
        newHeights[choice.startCol + j] += choice.colMap[j].count;
        added += choice.colMap[j].count;
      }
      const newFilled = top.filled + added;
      queue = queue.slice(0, top.queueLen);
      queue.push({ type: choice.type, rotation: choice.rotation, col: choice.startCol });

      if (newFilled === TOTAL_CELLS) return queue.slice();

      stack.push({
        heights: newHeights,
        candidates: shuffledCandidatesFor(newHeights),
        idx: 0,
        filled: newFilled,
        queueLen: queue.length,
      });
    }
    return null;
  }

  function fallbackQueue() {
    // Respaldo determinístico: el tablero (10x16) tiene ambos lados
    // pares, así que se puede llenar por completo únicamente con piezas
    // "O" apiladas de a pares de columnas, sin dejar nunca un hueco.
    const q = [];
    for (let pair = 0; pair < COLS / 2; pair++) {
      for (let k = 0; k < PHOTO_ROWS / 2; k++) {
        q.push({ type: "O", rotation: 0, col: pair * 2 });
      }
    }
    return q;
  }

  function generateQueue() {
    for (let attempt = 0; attempt < 20; attempt++) {
      const q = attemptSolveBacktrack(20000);
      if (q) return q;
    }
    return fallbackQueue();
  }

  // ---------------------------------------------------------------------
  // Estado del juego
  // ---------------------------------------------------------------------
  let grid;            // grid[row][col] = null | { type }
  let queue = [];       // [{ type, rotation, col }]
  let queueIndex = 0;
  let currentGuide = null; // guía (rotación/columna) de la pieza actual
  let lockedCount = 0;
  let current = null;  // { type, rotation, col, row }
  let fallTimer = null;
  let lockDelayTimer = null;
  let fallMs = BASE_FALL_MS;
  let running = false;
  let photoCanvas = null; // canvas offscreen con la foto ya recortada (cover)
  let cellSize = 24;

  // ---------------------------------------------------------------------
  // Referencias al DOM
  // ---------------------------------------------------------------------
  const screens = {
    start: document.getElementById("screen-start"),
    game: document.getElementById("screen-game"),
    win: document.getElementById("screen-win"),
    lose: document.getElementById("screen-lose"),
  };
  const boardCanvas = document.getElementById("board-canvas");
  const boardCtx = boardCanvas.getContext("2d");
  const nextCanvas = document.getElementById("next-canvas");
  const nextCtx = nextCanvas.getContext("2d");
  const winCanvas = document.getElementById("win-canvas");
  const progressCountEl = document.getElementById("progress-count");
  const progressTotalEl = document.getElementById("progress-total");

  progressTotalEl.textContent = TOTAL_CELLS;

  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
  }

  // ---------------------------------------------------------------------
  // Carga de la foto y preparación del "cover" sobre el tablero
  // ---------------------------------------------------------------------
  function preparePhoto() {
    return new Promise((resolve) => {
      const img = new Image();
      const boardPxW = COLS * 40; // resolución interna fija, luego se escala
      const boardPxH = PHOTO_ROWS * 40;

      const finish = (drawFn) => {
        const off = document.createElement("canvas");
        off.width = boardPxW;
        off.height = boardPxH;
        const octx = off.getContext("2d");
        drawFn(octx, boardPxW, boardPxH);
        photoCanvas = off;
        resolve();
      };

      img.onload = () => {
        finish((ctx, w, h) => {
          const scale = Math.max(w / img.width, h / img.height);
          const dw = img.width * scale;
          const dh = img.height * scale;
          const dx = (w - dw) / 2;
          const dy = (h - dh) / 2;
          ctx.drawImage(img, dx, dy, dw, dh);
        });
      };

      img.onerror = () => {
        // Sin foto disponible todavía: se genera un degradé discreto para
        // que el juego funcione igual. Al colocar assets/foto.jpg, este
        // camino deja de usarse.
        finish((ctx, w, h) => {
          const g = ctx.createLinearGradient(0, 0, w, h);
          g.addColorStop(0, "#2a2a33");
          g.addColorStop(1, "#111116");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
        });
      };

      img.src = IMAGE_PATH;
    });
  }

  // ---------------------------------------------------------------------
  // Piezas: helpers geométricos
  // ---------------------------------------------------------------------
  function cellsOf(piece) {
    return SHAPES[piece.type][piece.rotation].map(([c, r]) => [piece.col + c, piece.row + r]);
  }

  // Calcula dónde caería la pieza actual si se la lleva a la
  // rotación/columna que indica la guía (la solución exacta que arma el
  // tablero sin huecos). Es la "respuesta" que el jugador tiene que
  // imitar moviendo y rotando la pieza real.
  function computeGhostCells() {
    if (!currentGuide) return [];
    const test = { type: currentGuide.type, rotation: currentGuide.rotation, col: currentGuide.col, row: 0 };
    if (collides(test)) return []; // por las dudas, no debería pasar
    while (!collides({ ...test, row: test.row + 1 })) {
      test.row++;
    }
    return cellsOf(test);
  }

  function collides(piece) {
    for (const [c, r] of cellsOf(piece)) {
      if (c < 0 || c >= COLS || r >= TOTAL_ROWS) return true;
      if (r >= 0 && grid[r][c]) return true;
    }
    return false;
  }

  function spawnPiece() {
    if (queueIndex >= queue.length) return null;
    const guide = queue[queueIndex++];
    currentGuide = guide;
    const w = shapeWidth(guide.type, 0);
    const piece = { type: guide.type, rotation: 0, col: Math.floor((COLS - w) / 2), row: 0 };
    return piece;
  }

  // ---------------------------------------------------------------------
  // Ciclo de juego
  // ---------------------------------------------------------------------
  function startGame() {
    if (!photoCanvas) {
      // La foto todavía no terminó de cargar/preparar: reintentar en breve.
      setTimeout(startGame, 80);
      return;
    }
    grid = Array.from({ length: TOTAL_ROWS }, () => new Array(COLS).fill(null));
    queue = generateQueue();
    queueIndex = 0;
    currentGuide = null;
    lockedCount = 0;
    fallMs = BASE_FALL_MS;
    running = true;
    cancelLockDelay();

    updateProgress();

    current = spawnPiece();
    if (!current || collides(current)) {
      endGame(false);
      return;
    }

    showScreen("game");
    resizeBoard();
    render();
    scheduleFall();
  }

  function scheduleFall() {
    clearTimeout(fallTimer);
    if (!running) return;
    fallTimer = setTimeout(tick, fallMs);
  }

  function isLanded(piece) {
    return collides({ ...piece, row: piece.row + 1 });
  }

  function startLockDelay() {
    clearTimeout(fallTimer);
    if (lockDelayTimer) return; // ya está esperando
    lockDelayTimer = setTimeout(() => {
      lockDelayTimer = null;
      lockCurrent();
    }, LOCK_DELAY_MS);
  }

  function cancelLockDelay() {
    if (lockDelayTimer) {
      clearTimeout(lockDelayTimer);
      lockDelayTimer = null;
    }
  }

  // Se llama después de cualquier movimiento/rotación exitosos para
  // decidir si la pieza quedó apoyada (arranca el margen antes de
  // fijarla) o si sigue en el aire (retoma la caída normal).
  function afterPieceChanged() {
    if (!current) return;
    if (isLanded(current)) {
      startLockDelay();
    } else {
      cancelLockDelay();
      scheduleFall();
    }
  }

  function tick() {
    if (!running) return;
    const moved = { ...current, row: current.row + 1 };
    if (!collides(moved)) {
      current = moved;
      render();
      scheduleFall();
    } else {
      startLockDelay();
    }
  }

  function lockCurrent() {
    cancelLockDelay();
    for (const [c, r] of cellsOf(current)) {
      if (r < BUFFER_ROWS) { endGame(false); return; }
      grid[r][c] = { type: current.type };
    }
    lockedCount++;
    updateProgress();

    const next = spawnPiece();
    if (!next) {
      // No quedan piezas: como cada pieza aporta exactamente 4 celdas y
      // 40 piezas x 4 = 160 = tablero completo, llegar hasta acá sin
      // quedarse sin espacio significa que el tablero quedó entero.
      current = null;
      render();
      endGame(true);
      return;
    }

    current = next;
    if (collides(current)) {
      render();
      endGame(false);
      return;
    }

    render();
    scheduleFall();
  }

  function endGame(won) {
    running = false;
    clearTimeout(fallTimer);
    cancelLockDelay();
    if (won) {
      setTimeout(() => showWin(), 450);
    } else {
      showScreen("lose");
    }
  }

  function updateProgress() {
    progressCountEl.textContent = Math.min(lockedCount * 4, TOTAL_CELLS);
  }

  // ---------------------------------------------------------------------
  // Movimiento / input
  // ---------------------------------------------------------------------
  function tryMove(dx, dy) {
    if (!running || !current) return;
    const moved = { ...current, col: current.col + dx, row: current.row + dy };
    if (!collides(moved)) {
      current = moved;
      afterPieceChanged();
      render();
    } else if (dy > 0) {
      // ya está apoyado: mantiene (o inicia) el margen antes de fijarla
      startLockDelay();
    }
  }

  function tryRotate() {
    if (!running || !current) return;
    const rotations = SHAPES[current.type].length;
    const nextRotation = (current.rotation + 1) % rotations;
    const kicks = [0, -1, 1, -2, 2];
    for (const k of kicks) {
      const candidate = { ...current, rotation: nextRotation, col: current.col + k };
      if (!collides(candidate)) {
        current = candidate;
        afterPieceChanged();
        render();
        return;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  function resizeBoard() {
    const wrap = document.querySelector(".board-wrap");
    const availW = wrap.clientWidth - 16;
    const availH = wrap.clientHeight - 16;
    cellSize = Math.max(10, Math.floor(Math.min(availW / COLS, availH / TOTAL_ROWS)));
    boardCanvas.width = cellSize * COLS;
    boardCanvas.height = cellSize * TOTAL_ROWS;
  }

  function drawCellPhoto(ctx, sampleCol, sampleRow, pixelX, pixelY, size) {
    const sx = (sampleCol / COLS) * photoCanvas.width;
    const sy = (sampleRow / PHOTO_ROWS) * photoCanvas.height;
    const sw = photoCanvas.width / COLS;
    const sh = photoCanvas.height / PHOTO_ROWS;
    ctx.drawImage(photoCanvas, sx, sy, sw, sh, pixelX, pixelY, size + 0.5, size + 0.5);
  }

  function render() {
    const size = cellSize;
    boardCtx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);

    // celdas: primero el espacio libre de arriba (para mover/girar),
    // después el área que forma la foto
    for (let r = 0; r < TOTAL_ROWS; r++) {
      const inPhotoZone = r >= BUFFER_ROWS;
      for (let c = 0; c < COLS; c++) {
        const cell = grid[r][c];
        if (cell && inPhotoZone) {
          drawCellPhoto(boardCtx, c, r - BUFFER_ROWS, c * size, r * size, size);
        } else {
          boardCtx.fillStyle = inPhotoZone ? "#191920" : "#131317";
          boardCtx.fillRect(c * size, r * size, size - 1, size - 1);
        }
      }
    }

    // línea sutil que separa el espacio de maniobra del área de la foto
    boardCtx.strokeStyle = "rgba(255,255,255,0.08)";
    boardCtx.lineWidth = 1;
    boardCtx.beginPath();
    boardCtx.moveTo(0, BUFFER_ROWS * size + 0.5);
    boardCtx.lineTo(COLS * size, BUFFER_ROWS * size + 0.5);
    boardCtx.stroke();

    // guía: dónde va la pieza actual para que todo encastre
    const ghostCells = computeGhostCells();
    if (ghostCells.length) {
      boardCtx.strokeStyle = "rgba(217, 168, 92, 0.55)";
      boardCtx.lineWidth = 2;
      boardCtx.setLineDash([4, 3]);
      for (const [c, r] of ghostCells) {
        boardCtx.strokeRect(c * size + 2, r * size + 2, size - 4, size - 4);
      }
      boardCtx.setLineDash([]);
    }

    // pieza actual
    if (current) {
      boardCtx.fillStyle = COLORS[current.type];
      for (const [c, r] of cellsOf(current)) {
        roundRect(boardCtx, c * size + 1.5, r * size + 1.5, size - 3, size - 3, 4);
      }
    }

    renderNext();
  }

  function roundRect(ctx, x, y, w, h, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
    ctx.fill();
  }

  function renderNext() {
    nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    const upcoming = queue[queueIndex];
    if (!upcoming) return;
    const upcomingType = upcoming.type;
    const cells = SHAPES[upcomingType][0];
    const w = Math.max(...cells.map((c) => c[0])) + 1;
    const h = Math.max(...cells.map((c) => c[1])) + 1;
    const s = Math.floor(Math.min(nextCanvas.width / 4, nextCanvas.height / 4));
    const offX = (nextCanvas.width - w * s) / 2;
    const offY = (nextCanvas.height - h * s) / 2;
    nextCtx.fillStyle = COLORS[upcomingType];
    for (const [c, r] of cells) {
      roundRect(nextCtx, offX + c * s + 1, offY + r * s + 1, s - 2, s - 2, 3);
    }
  }

  function showWin() {
    winCanvas.width = photoCanvas.width;
    winCanvas.height = photoCanvas.height;
    const wctx = winCanvas.getContext("2d");
    wctx.drawImage(photoCanvas, 0, 0);
    showScreen("win");
  }

  // ---------------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------------
  document.getElementById("btn-play").addEventListener("click", () => startGame());
  document.getElementById("btn-restart-win").addEventListener("click", () => startGame());
  document.getElementById("btn-restart-lose").addEventListener("click", () => startGame());

  function bindHold(el, fn, repeatMs) {
    let interval = null;
    let activePointerId = null;

    const clear = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      activePointerId = null;
    };

    const start = (e) => {
      e.preventDefault();
      // Por si quedó un intervalo colgado de un toque anterior que no
      // llegó a soltarse bien (típico si el dedo se arrastra fuera del
      // botón en mobile): lo cortamos antes de arrancar uno nuevo.
      clear();
      if (e.pointerId !== undefined) activePointerId = e.pointerId;
      fn();
      interval = setInterval(fn, repeatMs);
    };

    const stop = (e) => {
      if (e && e.pointerId !== undefined && activePointerId !== null && e.pointerId !== activePointerId) {
        return;
      }
      clear();
    };

    if (window.PointerEvent) {
      // Pointer Events unifica touch/mouse en un solo flujo de eventos y
      // evita el problema clásico de mobile donde touchend no llega a
      // dispararse sobre el botón si el dedo se corrió un poco.
      el.addEventListener("pointerdown", start);
      el.addEventListener("pointerup", stop);
      el.addEventListener("pointercancel", stop);
      el.addEventListener("pointerleave", stop);
    } else {
      el.addEventListener("touchstart", start, { passive: false });
      el.addEventListener("touchend", stop);
      el.addEventListener("touchcancel", stop);
      el.addEventListener("mousedown", start);
      el.addEventListener("mouseup", stop);
      el.addEventListener("mouseleave", stop);
    }

    // Red de seguridad extra: si la pantalla se bloquea, cambia de app,
    // o el navegador oculta la pestaña con el dedo todavía "apretado",
    // no queremos que el intervalo se quede corriendo en segundo plano.
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) clear();
    });
  }

  bindHold(document.getElementById("btn-left"), () => tryMove(-1, 0), 130);
  bindHold(document.getElementById("btn-right"), () => tryMove(1, 0), 130);
  bindHold(document.getElementById("btn-down"), () => tryMove(0, 1), 90);
  document.getElementById("btn-rotate").addEventListener("click", (e) => {
    e.preventDefault();
    tryRotate();
  });

  window.addEventListener("keydown", (e) => {
    if (!running) return;
    switch (e.key) {
      case "ArrowLeft": tryMove(-1, 0); break;
      case "ArrowRight": tryMove(1, 0); break;
      case "ArrowDown": tryMove(0, 1); break;
      case "ArrowUp":
      case " ":
        tryRotate();
        break;
      default: return;
    }
    e.preventDefault();
  });

  window.addEventListener("resize", () => {
    if (screens.game.classList.contains("active")) {
      resizeBoard();
      render();
    }
  });

  // ---------------------------------------------------------------------
  // Arranque
  // ---------------------------------------------------------------------
  preparePhoto();
})();
