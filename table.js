import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const fs = require('fs/promises');
const { createCanvas, loadImage } = require('canvas')
const width = 2100;
const height = 300;
const canvas = createCanvas(width, height);
const ctx = canvas.getContext("2d");

// Table data

// Dimensions
const colWidths = [300, 300, 300, 300, 300, 300, 300];
const rowHeight = 100;


// Dark mode palette
const colors = {
  background: "#121212",
  headerBg: "#1f1f1f",
  headerText: "#ffffff",
  rowEven: "#1a1a1a",
  rowOdd: "#222222",
  text: "#e0e0e0",
  border: "#444444",
};

// Styles
ctx.fillStyle = colors.background;
ctx.fillRect(0, 0, width, height);
ctx.strokeStyle = colors.border;
ctx.lineWidth = 2;
ctx.font = "32px";
ctx.textAlign = "center";
ctx.textBaseline = "middle";

// Draw table
function drawTable(x, y, rows, headers) {
  // total width
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  const totalHeight = rowHeight * (rows.length + 1);

  // Outer border
  ctx.strokeStyle = colors.border;
  ctx.strokeRect(x, y, totalWidth, totalHeight);

  // Vertical lines
  let cx = x;
  for (let i = 0; i < colWidths.length; i++) {
    cx += colWidths[i];
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.lineTo(cx, y + totalHeight);
    ctx.stroke();
  }

  // Horizontal lines
  for (let r = 1; r <= rows.length + 1; r++) {
    let cy = y + r * rowHeight;
    ctx.beginPath();
    ctx.moveTo(x, cy);
    ctx.lineTo(x + totalWidth, cy);
    ctx.stroke();
  }

  // Draw headers
  let startX = x;
  headers.forEach((h, i) => {
    let colWidth = colWidths[i];
    ctx.fillStyle = colors.headerBg;
    ctx.fillRect(startX, y, colWidth, rowHeight);
    ctx.fillStyle = colors.headerText;
    ctx.fillText(h, startX + colWidth / 2, y + rowHeight / 2);
    startX += colWidth;
  });

  // Draw rows
  rows.forEach((row, rowIndex) => {
    let cy = y + (rowIndex + 1) * rowHeight;
    let cx = x;
    row.forEach((cell, i) => {
      let colWidth = colWidths[i];
      ctx.fillStyle = rowIndex % 2 === 0 ? colors.rowEven : colors.rowOdd;
      ctx.fillRect(cx, cy, colWidth, rowHeight);
      ctx.fillStyle = colors.text;

      ctx.fillText(cell, cx + colWidth / 2, cy + rowHeight / 2);
      cx += colWidth;
    });
  });
}
async function render(rows, headers) {

  drawTable(0, 0, rows, headers);

  // Save
  const buffer = canvas.toBuffer("image/png");
  return buffer;
}

export { render }