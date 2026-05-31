export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function snap(value, grid = 1) {
  return Math.round(value / grid) * grid;
}

export function snapPoint(point, grid = 1) {
  return { x: snap(point.x, grid), y: snap(point.y, grid) };
}

export function wallLength(wall) {
  return Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
}

export function wallOrientation(wall) {
  const dx = Math.abs(wall.x2 - wall.x1);
  const dy = Math.abs(wall.y2 - wall.y1);
  if (dy < 0.05) return "horizontal";
  if (dx < 0.05) return "vertical";
  return "angled";
}

export function formatFeet(value) {
  const totalHalfInches = Math.max(0, Math.round(value * 24));
  const totalInches = totalHalfInches / 2;
  const feet = Math.floor(totalInches / 12);
  const inchesFloat = totalInches - feet * 12;
  const whole = Math.floor(inchesFloat);
  const hasHalf = Math.abs(inchesFloat - whole - 0.5) < 0.01;
  const inches = hasHalf ? `${whole} 1/2` : `${Math.round(inchesFloat)}`;
  return `${feet}' ${inches}"`;
}

export function formatArea(value) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return `${Math.round(value).toLocaleString()} sq ft`;
}

export function parseFeetInches(value) {
  if (!value) return null;
  const normalized = String(value).trim().replace(/[’′]/g, "'").replace(/[“”″]/g, '"');
  const feetMatch = normalized.match(/(-?\d+(?:\.\d+)?)\s*'/);
  const inchesMatch = normalized.match(/'\s*(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?\s*"?/);
  const bareInchesMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*"?$/);
  const feet = feetMatch ? Number(feetMatch[1]) : 0;
  let inches = 0;
  if (inchesMatch) {
    inches = Number(inchesMatch[1] || 0);
    if (inchesMatch[2] && inchesMatch[3]) inches += Number(inchesMatch[2]) / Number(inchesMatch[3]);
  } else if (!feetMatch && bareInchesMatch) {
    inches = Number(bareInchesMatch[1]);
  }
  if (!feetMatch && !inchesMatch && !bareInchesMatch) return null;
  return feet + inches / 12;
}

export function parseDimensionPair(value) {
  if (!value) return null;
  const parts = String(value).toLowerCase().split(/\s*x\s*/);
  if (parts.length !== 2) return null;
  const width = parseFeetInches(parts[0]);
  const height = parseFeetInches(parts[1]);
  if (!width || !height) return null;
  return { width, height, area: width * height };
}

function edgeKey(kind, a, b) {
  const ordered = a < b ? `${a}:${b}` : `${b}:${a}`;
  return `${kind}:${ordered}`;
}

function cellIndexForPoint(point, bounds, step) {
  const col = Math.floor((point.x - bounds.x) / step);
  const row = Math.floor((point.y - bounds.y) / step);
  return { col, row };
}

function pointToNode(point, bounds, step) {
  return {
    col: Math.round((point.x - bounds.x) / step),
    row: Math.round((point.y - bounds.y) / step)
  };
}

export function calculateAreaMetrics(walls, labels, bounds, step = 0.5) {
  const cols = Math.ceil(bounds.width / step);
  const rows = Math.ceil(bounds.height / step);
  const vertical = new Set();
  const horizontal = new Set();

  for (const wall of walls) {
    const orientation = wallOrientation(wall);
    if (orientation === "angled") continue;
    const start = pointToNode({ x: wall.x1, y: wall.y1 }, bounds, step);
    const end = pointToNode({ x: wall.x2, y: wall.y2 }, bounds, step);
    if (orientation === "vertical") {
      const col = start.col;
      const from = Math.min(start.row, end.row);
      const to = Math.max(start.row, end.row);
      for (let row = from; row < to; row += 1) vertical.add(edgeKey("v", col, row));
    } else {
      const row = start.row;
      const from = Math.min(start.col, end.col);
      const to = Math.max(start.col, end.col);
      for (let col = from; col < to; col += 1) horizontal.add(edgeKey("h", col, row));
    }
  }

  const visited = new Uint8Array(cols * rows);
  const componentIds = new Int32Array(cols * rows).fill(-1);
  const components = [];
  const index = (col, row) => row * cols + col;

  function canMove(col, row, nextCol, nextRow) {
    if (nextCol < 0 || nextRow < 0 || nextCol >= cols || nextRow >= rows) return false;
    if (nextCol > col) return !vertical.has(edgeKey("v", col + 1, row));
    if (nextCol < col) return !vertical.has(edgeKey("v", col, row));
    if (nextRow > row) return !horizontal.has(edgeKey("h", col, row + 1));
    if (nextRow < row) return !horizontal.has(edgeKey("h", col, row));
    return false;
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const seed = index(col, row);
      if (visited[seed]) continue;
      const id = components.length;
      const stack = [[col, row]];
      let count = 0;
      let touchesOuterBounds = false;
      visited[seed] = 1;

      while (stack.length) {
        const [currentCol, currentRow] = stack.pop();
        const currentIndex = index(currentCol, currentRow);
        componentIds[currentIndex] = id;
        count += 1;
        if (currentCol === 0 || currentRow === 0 || currentCol === cols - 1 || currentRow === rows - 1) {
          touchesOuterBounds = true;
        }
        for (const [nextCol, nextRow] of [
          [currentCol + 1, currentRow],
          [currentCol - 1, currentRow],
          [currentCol, currentRow + 1],
          [currentCol, currentRow - 1]
        ]) {
          if (!canMove(currentCol, currentRow, nextCol, nextRow)) continue;
          const nextIndex = index(nextCol, nextRow);
          if (visited[nextIndex]) continue;
          visited[nextIndex] = 1;
          stack.push([nextCol, nextRow]);
        }
      }

      components.push({
        area: count * step * step,
        enclosed: !touchesOuterBounds
      });
    }
  }

  const metrics = {};
  for (const label of labels) {
    const printed = parseDimensionPair(label.dimensions);
    const labelCell = cellIndexForPoint(label, bounds, step);
    const inBounds = labelCell.col >= 0 && labelCell.row >= 0 && labelCell.col < cols && labelCell.row < rows;
    const component = inBounds ? components[componentIds[index(labelCell.col, labelCell.row)]] : null;
    const detectedArea = component?.enclosed && component.area < 2500 ? component.area : null;
    metrics[label.id] = {
      printedArea: printed?.area ?? null,
      detectedArea,
      enclosed: Boolean(detectedArea)
    };
  }
  return metrics;
}

export function cleanNumber(value) {
  return Number(Number(value).toFixed(2));
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function doorArcPath(opening) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const sx = opening.x + Math.cos(toRadians(opening.start)) * opening.r;
  const sy = opening.y + Math.sin(toRadians(opening.start)) * opening.r;
  const ex = opening.x + Math.cos(toRadians(opening.end)) * opening.r;
  const ey = opening.y + Math.sin(toRadians(opening.end)) * opening.r;
  return `M ${opening.x} ${opening.y} L ${sx} ${sy} A ${opening.r} ${opening.r} 0 0 1 ${ex} ${ey}`;
}
